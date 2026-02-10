const https = require('https');

const SYSTEM_PROMPT = `
# Rôle de l’IA
Tu es l’assistant officiel de l’application DeadPions.
Ton objectif est d’aider l’utilisateur de manière claire, rapide et fiable.

# Règles de réponse
- Explique les choses simplement, étape par étape si nécessaire
- Adapte ton langage au niveau de l’utilisateur (débutant ou avancé)
- Sois neutre, précis et bienveillant
- Ne donne jamais de réponses trompeuses ou non vérifiées
- Si une information est incertaine, indique-le clairement

# Fonctionnalités d’aide
- Expliquer les règles et mécaniques du jeu DeadPions
- Aider à comprendre les choix possibles et leurs conséquences
- Donner des conseils stratégiques sans tricher
- Aider à résoudre des problèmes techniques liés à l’application

# Ton
Professionnel, amical et motivant.
Tu dois donner envie à l’utilisateur de continuer à jouer et à progresser.
`;

exports.chat = async (req, res) => {
  try {
    const { message, history } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(history || []),
      { role: 'user', content: message }
    ];

    const requestBody = JSON.stringify({
      model: 'gpt-4o-mini',
      messages: messages,
      max_tokens: 500
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Length': Buffer.byteLength(requestBody)
      }
    };

    const request = https.request(options, (response) => {
      let data = '';

      response.on('data', (chunk) => {
        data += chunk;
      });

      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          try {
            const parsedData = JSON.parse(data);
            const aiMessage = parsedData.choices[0].message.content;
            res.json({ message: aiMessage });
          } catch (e) {
             console.error('Error parsing OpenAI response:', e);
             res.status(500).json({ error: 'Error parsing AI response' });
          }
        } else {
          console.error('OpenAI API Error Status:', response.statusCode);
          console.error('OpenAI API Error Body:', data);
          res.status(response.statusCode).json({ error: 'Error communicating with AI service' });
        }
      });
    });

    request.on('error', (error) => {
      console.error('Request Error:', error);
      res.status(500).json({ error: 'Internal server error' });
    });

    request.write(requestBody);
    request.end();

  } catch (error) {
    console.error('AI Controller Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
