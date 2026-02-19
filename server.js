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
const GEMINI_MODEL = "gemini-1.5-flash"; // modelo mais leve

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
    to,
    type: "text",
    text: {
      preview_url: false,
      body: text,
    },
  };

  try {
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
      return false;
    }

    return true;
  } catch (err) {
    console.error("❌ Falha ao enviar mensagem:", err.message);
    return false;
  }
}

/* ==============================
   🤖 Gemini
============================== */

async function generateGeminiResponse(userText) {
  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

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
    throw new Error("GeminiError");
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
    console.log("✅ Webhook verificado!");
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

/* ==============================
   📥 Receber mensagens
============================== */

app.post("/webhook", async (req, res) => {
  try {
    const message = req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message?.text?.body) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const userText = message.text.body;

    console.log(`📩 ${from}: ${userText}`);

    let reply;

    try {
      reply = await generateGeminiResponse(userText);
    } catch (err) {
      console.log("⚠️ Usando fallback de resposta.");
      reply =
        "🤖 Estou temporariamente sem acesso à IA no momento. Tente novamente em instantes.";
    }

    await sendWhatsAppMessage(from, reply);

    // SEMPRE responder 200 para evitar retry da Meta
    return res.sendStatus(200);
  } catch (error) {
    console.error("❌ Erro geral no webhook:", error.message);

    // Nunca retornar 500 para webhook
    return res.sendStatus(200);
  }
});

/* ==============================
   🚀 Inicialização
============================== */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});