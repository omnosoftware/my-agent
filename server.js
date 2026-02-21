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
  GEMINI_MODEL = "gemini-1.5-flash"
} = process.env;

const GRAPH_API_VERSION = "v21.0";

if (!VERIFY_TOKEN || !GEMINI_API_KEY || !WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
  console.error("❌ Variáveis de ambiente faltando.");
  process.exit(1);
}

/* ==============================
   🛡️ Proteções em memória
============================== */

// Anti duplicação
const processedMessages = new Set();

// Rate limit simples por número
const lastMessageTime = {};
const MESSAGE_COOLDOWN = 4000; // 4 segundos

// Bloqueio temporário quando quota estoura
let geminiBlockedUntil = 0;

/* ==============================
   📩 Enviar mensagem WhatsApp
============================== */

async function sendWhatsAppMessage(to, text) {
  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: {
          preview_url: false,
          body: text,
        },
      }),
    });

    if (!response.ok) {
      const err = await response.json();
      console.error("❌ Erro WhatsApp:", err);
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
  // Se bloqueado por 429 recente
  if (Date.now() < geminiBlockedUntil) {
    console.log("⛔ Gemini temporariamente bloqueado por quota.");
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

  try {
    console.log("🔎 Modelo usado:", GEMINI_MODEL);

    const response = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: userText }],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 200,
        },
      }),
    });

    clearTimeout(timeout);

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Erro Gemini:", data);

      // Se for rate limit
      if (response.status === 429) {
        geminiBlockedUntil = Date.now() + 60000; // bloqueia por 1 minuto
        console.log("🚫 Gemini bloqueado por 60s devido a quota.");
      }

      return null;
    }

    return (
      data?.candidates?.[0]?.content?.parts?.[0]?.text ||
      null
    );

  } catch (err) {
    console.error("❌ Falha Gemini:", err.message);
    return null;
  }
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

    const messageId = message.id;
    const from = message.from;
    const userText = message.text.body.trim();

    // 🔁 Anti duplicação
    if (processedMessages.has(messageId)) {
      return res.sendStatus(200);
    }
    processedMessages.add(messageId);

    // ⏱ Rate limit simples
    if (
      lastMessageTime[from] &&
      Date.now() - lastMessageTime[from] < MESSAGE_COOLDOWN
    ) {
      console.log("⚠️ Rate limit por número:", from);
      return res.sendStatus(200);
    }

    lastMessageTime[from] = Date.now();

    console.log(`📩 ${from}: ${userText}`);

    let reply = await generateGeminiResponse(userText);

    if (!reply) {
      reply =
        "🤖 Estou temporariamente com alto volume ou limite de uso. Tente novamente em instantes.";
    }

    await sendWhatsAppMessage(from, reply);

    return res.sendStatus(200);

  } catch (error) {
    console.error("❌ Erro geral no webhook:", error.message);
    return res.sendStatus(200);
  }
});

/* ==============================
   🚀 Inicialização
============================== */

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});