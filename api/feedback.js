// api/feedback.js
// Función serverless de Vercel para guardar y leer propuestas/feedback.
// Usa Upstash Redis (vía REST API) como almacenamiento persistente y compartido.
//
// Variables de entorno necesarias (las inyecta automáticamente la integración
// de Upstash desde el Marketplace de Vercel):
//   KV_REST_API_URL
//   KV_REST_API_TOKEN
//
// Además, reutilizamos las mismas credenciales de autor que en la web para
// proteger la lectura (GET) del listado de feedback:
//   EDITOR_USER
//   EDITOR_PASS

const FEEDBACK_LIST_KEY = 'lalistadelgloton:feedback';
const MAX_ITEMS = 300; // evita crecimiento sin límite

function getEnv(name) {
  return process.env[name];
}

async function redisRequest(command) {
  const url = getEnv('KV_REST_API_URL');
  const token = getEnv('KV_REST_API_TOKEN');
  if (!url || !token) {
    throw new Error('Faltan las variables de entorno de Upstash (KV_REST_API_URL / KV_REST_API_TOKEN)');
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upstash error ${res.status}: ${text}`);
  }
  return res.json();
}

function isAuthorized(req) {
  const user = getEnv('EDITOR_USER');
  const pass = getEnv('EDITOR_PASS');
  if (!user || !pass) return false;
  const header = req.headers['authorization'] || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
  const sepIndex = decoded.indexOf(':');
  if (sepIndex === -1) return false;
  const reqUser = decoded.slice(0, sepIndex);
  const reqPass = decoded.slice(sepIndex + 1);
  return reqUser === user && reqPass === pass;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { name, message, contact } = req.body || {};
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'Falta el mensaje' });
      }
      const item = {
        name: (name || '').toString().slice(0, 100),
        message: message.toString().slice(0, 1000),
        contact: (contact || '').toString().slice(0, 200),
        createdAt: new Date().toISOString(),
      };
      // LPUSH al principio de la lista + recorte para no crecer indefinidamente
      await redisRequest(['LPUSH', FEEDBACK_LIST_KEY, JSON.stringify(item)]);
      await redisRequest(['LTRIM', FEEDBACK_LIST_KEY, 0, MAX_ITEMS - 1]);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      // Protegemos la lectura: solo el autor puede ver el feedback recibido.
      // El navegador pedirá usuario/contraseña automáticamente (Basic Auth).
      if (!isAuthorized(req)) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Feedback"');
        return res.status(401).json({ error: 'No autorizado' });
      }
      const result = await redisRequest(['LRANGE', FEEDBACK_LIST_KEY, 0, MAX_ITEMS - 1]);
      const raw = (result && result.result) || [];
      const items = raw
        .map((s) => {
          try {
            return JSON.parse(s);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);
      return res.status(200).json(items);
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  } catch (err) {
    console.error('Error en /api/feedback:', err);
    return res.status(500).json({ error: 'Error inesperado en el servidor' });
  }
}
