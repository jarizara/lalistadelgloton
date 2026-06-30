// api/recommend.js
// Función serverless de Vercel. Se ejecuta en el servidor, nunca en el navegador.
// La clave de la API de Anthropic vive en una variable de entorno (ANTHROPIC_API_KEY),
// configurada en el dashboard de Vercel, y nunca se expone al cliente.

export default async function handler(req, res) {
  // Solo aceptamos POST
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('Falta la variable de entorno ANTHROPIC_API_KEY en Vercel');
    return res.status(500).json({ error: 'Configuración del servidor incompleta' });
  }

  const { question, context, count } = req.body || {};

  if (!question || typeof question !== 'string' || !question.trim()) {
    return res.status(400).json({ error: 'Falta la pregunta' });
  }
  if (!context || typeof context !== 'string') {
    return res.status(400).json({ error: 'Falta el contexto de restaurantes' });
  }

  // Limitamos la longitud para evitar abusos / costes descontrolados
  const safeQuestion = question.slice(0, 500);
  const safeContext = context.slice(0, 20000);

  const systemPrompt = `Eres un amigo madrileño con muy buen gusto gastronómico, ayudando a elegir restaurante de una lista personal ya curada de ${count || 'varios'} sitios en Madrid.
Cada línea de la lista tiene el formato: Nombre | Categoría | Precio | Tipo de cocina | Zona | Frase highlight.
Responde SIEMPRE en español, en JSON puro sin texto antes ni después, sin backticks de markdown, con este formato exacto:
{"intro":"una frase breve y cercana de contexto/explicación de tu elección","recommendations":[{"name":"Nombre EXACTO tal como aparece en la lista","why":"1-2 frases explicando por qué encaja con lo que pide el usuario"}]}
Reglas:
- Recomienda entre 1 y 3 restaurantes, los que mejor encajen, nunca más de 3.
- El campo "name" debe coincidir EXACTAMENTE con el nombre tal como aparece en la lista proporcionada.
- Si la petición menciona una zona/barrio, prioriza restaurantes de esa zona o muy cercana.
- Si menciona una ocasión (familia, pareja, amigos, trabajo, reunión con salón privado, cumpleaños, etc.), elige el ambiente y tipo de cocina adecuados.
- Si no hay ningún restaurante que encaje razonablemente bien, dilo con sinceridad en "intro" y deja "recommendations" como una lista vacía.
- No inventes restaurantes que no estén en la lista.

Lista de restaurantes:
${safeContext}`;

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: 'user', content: safeQuestion }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error('Anthropic API error:', anthropicRes.status, errText);
      return res.status(502).json({ error: 'Error consultando la IA' });
    }

    const anthropicData = await anthropicRes.json();
    const textBlock = (anthropicData.content || []).find((b) => b.type === 'text');
    let raw = textBlock ? textBlock.text.trim() : '';
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/, '').replace(/```\s*$/, '').trim();

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      // Si el modelo no devolvió JSON limpio, lo mandamos igualmente como "intro"
      // para que el usuario vea algo en vez de un error genérico.
      parsed = { intro: raw || 'No he podido generar una recomendación clara, ¿puedes reformular la pregunta?', recommendations: [] };
    }

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('Error inesperado:', err);
    return res.status(500).json({ error: 'Error inesperado en el servidor' });
  }
}
