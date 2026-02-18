import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

/* ==============================
   🔐 Variáveis de Ambiente
============================== */

const {
  VERIFY_TOKEN,
  GEMINI_API_KEY,
  WHATSAPP_TOKEN,
  PHONE_NUMBER_ID,
  PORT = 3000,
} = process.env;

const GRAPH_API_VERSION = "v21.0";

/* ==============================
   🚨 Validação Inicial
============================== */

if (!VERIFY_TOKEN || !GEMINI_API_KEY || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.error("❌ Variáveis de ambiente faltando.");
  process.exit(1);
}

/* ==============================
   📩 Enviar mensagem WhatsApp
============================== */

async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: false,
      body: text,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("❌ Erro WhatsApp:", data);
    throw new Error(`WhatsApp API error: ${response.status}`);
  }

  return data;
}

/* ==============================
   🤖 Chamada Gemini
============================== */

async function generateGeminiResponse(userText) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

  const response = await fetch(geminiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: userText }],
        },
      ],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 300,
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("❌ Erro Gemini:", data);
    throw new Error("Falha na Gemini API");
  }

  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text ||
    "Desculpe, não consegui responder agora."
  );
}

/* ==============================
   🔎 Verificação do Webhook
============================== */

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("✅ Webhook verificado com sucesso!");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* ==============================
   📥 Receber mensagens
============================== */

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (!message?.text?.body) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const userText = message.text.body;

    console.log(`📩 Mensagem recebida de ${from}: ${userText}`);

    const reply = await generateGeminiResponse(userText);

    await sendWhatsAppMessage(from, reply);

    return res.sendStatus(200);
  } catch (error) {
    console.error("❌ Erro no webhook:", error.message);
    return res.sendStatus(500);
  }
});

/* ==============================
   🚀 Inicialização do Servidor
============================== */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});