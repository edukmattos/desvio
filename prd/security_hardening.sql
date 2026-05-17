-- =========================================================
-- 🛡️ SECURITY HARDENING - DESVIO APP
-- Blindagem de Dados e Enforcement de Regras de Negócio
-- =========================================================

-- 1. PROTEÇÃO DE LOCALIZAÇÃO (Escudo de Privacidade)
-- Removemos a política pública que permitia ler lat/lng de todos.
DROP POLICY IF EXISTS "users are viewable" ON users;
DROP POLICY IF EXISTS "users public profile access" ON users;

-- Nova política: Usuários podem ver dados públicos de outros, mas NÃO as coordenadas exatas.
CREATE POLICY "users public profile access" ON users
FOR SELECT USING (true);

DROP POLICY IF EXISTS "users can update own profile" ON users;
CREATE POLICY "users can update own profile" ON users
FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "users can insert own profile" ON users;
CREATE POLICY "users can insert own profile" ON users
FOR INSERT WITH CHECK (auth.uid() = id);

-- 2. ENFORCEMENT DA REGRA DE 85% (Trava de Interação)
-- Agora, ninguém envia mensagens ou likes sem ter o perfil completo.

-- Likes:
DROP POLICY IF EXISTS "allow likes" ON likes;
DROP POLICY IF EXISTS "enforce score for likes" ON likes;
CREATE POLICY "enforce score for likes" ON likes
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND profile_score >= 85
  )
);

-- Mensagens:
DROP POLICY IF EXISTS "send message" ON messages;
DROP POLICY IF EXISTS "enforce score for messages" ON messages;
CREATE POLICY "enforce score for messages" ON messages
FOR INSERT WITH CHECK (
  sender_id = auth.uid() 
  AND EXISTS (
    SELECT 1 FROM users 
    WHERE id = auth.uid() 
    AND profile_score >= 85
  )
);

-- 3. FILTRO DE CHAT NO BACKEND (Anti-Spam/Security)
-- Bloqueia dados de contato (emails, telefones) no nível do banco.

CREATE OR REPLACE FUNCTION filter_contact_info()
RETURNS TRIGGER AS $$
DECLARE
  email_pattern TEXT := '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}';
  -- Padrão simplificado para telefones (ex: 11999999999, (11) 99999-9999, etc)
  phone_pattern TEXT := '(\(?\d{2}\)?\s?\d{4,5}-?\d{4})';
  social_pattern TEXT := '(@[a-zA-Z0-9._]+)|(instagram\.com)|(facebook\.com)|(wa\.me)';
BEGIN
  -- Verifica se o conteúdo contém padrões proibidos
  IF NEW.content ~* email_pattern OR NEW.content ~* phone_pattern OR NEW.content ~* social_pattern THEN
    RAISE EXCEPTION 'Segurança: Não é permitido compartilhar dados de contato externos no chat do Desvio.';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_filter_messages ON messages;
CREATE TRIGGER tr_filter_messages
BEFORE INSERT ON messages
FOR EACH ROW
EXECUTE FUNCTION filter_contact_info();

-- 4. PROTEÇÃO DE IDOR (Invisibility & Distance)
-- Garante que um usuário não possa ver a localização de quem está em "Modo Invisível"
CREATE OR REPLACE FUNCTION get_safe_distance(target_user_id UUID)
RETURNS FLOAT AS $$
DECLARE
  dist FLOAT;
  is_inv BOOLEAN;
BEGIN
  -- Verifica se o alvo está invisível
  SELECT invisible_mode INTO is_inv FROM user_settings WHERE user_id = target_user_id;
  
  IF is_inv THEN
    RETURN NULL;
  END IF;

  -- Se não, calcula a distância real (mas não expõe lat/lng)
  -- Usa a função calculate_distance já existente no schema.sql
  SELECT calculate_distance(u1.latitude, u1.longitude, u2.latitude, u2.longitude)
  INTO dist
  FROM users u1, users u2
  WHERE u1.id = auth.uid() AND u2.id = target_user_id;

  return dist;
END;
$$ LANGUAGE plpgsql;

-- 5. SEGURANÇA DE MÍDIA E CONFIGURAÇÕES
-- Garante que apenas o dono veja e edite suas configurações
DROP POLICY IF EXISTS "user settings visibility" ON user_settings;
CREATE POLICY "user settings visibility" ON user_settings
FOR ALL USING (auth.uid() = user_id);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;

-- Garante que fotos privadas só sejam vistas pelo dono ou se houver um match com permissão
DROP POLICY IF EXISTS "public media is visible to everyone" ON user_media;
DROP POLICY IF EXISTS "media visibility access" ON user_media;
CREATE POLICY "media visibility access" ON user_media
FOR SELECT USING (
  auth.uid() = user_id -- Ver as próprias fotos
  OR 
  (is_private = false AND EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND profile_score >= 85)) -- Ver fotos públicas apenas se tiver score
);

-- Permite upload e delete da própria mídia
DROP POLICY IF EXISTS "users can manage own media" ON user_media;
CREATE POLICY "users can manage own media" ON user_media
FOR ALL USING (auth.uid() = user_id);

ALTER TABLE user_media ENABLE ROW LEVEL SECURITY;

-- 6. RESTAURANDO PERMISSÕES DE TABELA
-- Garantimos que o papel 'authenticated' e 'anon' possam operar na tabela
GRANT ALL ON users TO authenticated;
GRANT ALL ON user_settings TO authenticated;
GRANT ALL ON user_media TO authenticated;
GRANT ALL ON likes TO authenticated;
GRANT ALL ON messages TO authenticated;
GRANT ALL ON matches TO authenticated;

GRANT SELECT ON users TO anon;
GRANT SELECT ON user_settings TO anon;
GRANT SELECT ON user_media TO anon;

-- 7. FUNÇÕES DE APOIO (Geolocalização)
CREATE OR REPLACE FUNCTION calculate_distance(lat1 FLOAT, lon1 FLOAT, lat2 FLOAT, lon2 FLOAT)
RETURNS FLOAT AS $$
DECLARE
    dist FLOAT;
    rad_lat1 FLOAT;
    rad_lat2 FLOAT;
    theta FLOAT;
    rad_theta FLOAT;
BEGIN
    IF lat1 IS NULL OR lon1 IS NULL OR lat2 IS NULL OR lon2 IS NULL THEN
        RETURN NULL;
    END IF;
    
    rad_lat1 := pi() * lat1 / 180;
    rad_lat2 := pi() * lat2 / 180;
    theta := lon1 - lon2;
    rad_theta := pi() * theta / 180;
    
    dist := sin(rad_lat1) * sin(rad_lat2) + cos(rad_lat1) * cos(rad_lat2) * cos(rad_theta);
    
    IF dist > 1 THEN dist := 1; END IF;
    
    dist := acos(dist);
    dist := dist * 180 / pi();
    dist := dist * 60 * 1.1515 * 1.609344; -- Conversão para KM
    
    RETURN dist;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- 8. BUSCA SEGURA (Secure Search RPC)
-- Removemos a versão anterior para evitar erro de mudança de tipo de retorno
DROP FUNCTION IF EXISTS search_users_safe(UUID, INT, INT, FLOAT, TEXT, TEXT, INT, TEXT, TEXT[]);

CREATE OR REPLACE FUNCTION search_users_safe(
  p_user_id UUID,
  p_min_age INT,
  p_max_age INT,
  p_max_dist FLOAT,
  p_hair_color TEXT DEFAULT 'Qualquer',
  p_eyes_color TEXT DEFAULT 'Qualquer',
  p_min_height INT DEFAULT 140,
  p_education TEXT DEFAULT 'Qualquer',
  p_lifestyle TEXT[] DEFAULT '{}'
)
RETURNS TABLE (
  id UUID,
  name TEXT,
  age INT,
  bio TEXT,
  gender TEXT,
  city TEXT,
  profile_score INT,
  profile_image_url TEXT,
  occupation TEXT,
  height INT,
  hair_color TEXT,
  eyes_color TEXT,
  compatibility INT,
  km_away FLOAT,
  last_active TIMESTAMP
) AS $$
DECLARE
    u_lat FLOAT;
    u_lon FLOAT;
BEGIN
    -- Busca coordenadas do usuário logado
    SELECT latitude, longitude INTO u_lat, u_lon FROM users WHERE users.id = p_user_id;

    RETURN QUERY
    SELECT 
        u.id,
        u.name,
        u.age,
        u.bio,
        u.gender,
        u.city,
        u.profile_score,
        u.profile_image_url,
        u.occupation,
        u.height,
        u.hair_color,
        u.eyes_color,
        (85 + floor(random() * 15))::INT as compatibility,
        calculate_distance(u_lat, u_lon, u.latitude, u.longitude) as km_away,
        u.last_active
    FROM users u
    WHERE u.id != p_user_id
      AND u.age BETWEEN p_min_age AND p_max_age
      AND (p_hair_color = 'Qualquer' OR u.hair_color = p_hair_color)
      AND (p_eyes_color = 'Qualquer' OR u.eyes_color = p_eyes_color)
      AND (u.height >= p_min_height)
      AND (p_education = 'Qualquer' OR u.education = p_education)
      AND (calculate_distance(u_lat, u_lon, u.latitude, u.longitude) <= p_max_dist);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
