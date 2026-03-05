import axios from "axios";

/**
 * JomRewards Message Handler
 *
 * This module handles incoming WhatsApp messages and triggers the JomRewards API
 * based on the /postdesmond command.
 *
 * Usage:
 * Import this and call jomrewards_api_send_message(sock, m) in your messages.upsert event.
 */

const JOMREWARDS_API_URL = "https://app.jomrewards.my/api/public/send-message/";
const JOMREWARDS_API_KEY =
  "sk_kKQDnHr73uI_cCrx4RdFeq9v9QL6t5U8IBKp-GycUOMvUK2qdcWyug";

/**
 * Checks for incoming messages and processes /postdesmond command
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {any} m
 */
export async function jomrewards_api_send_message(sock, m) {
  try {
    // Only process new messages (upsert)
    if (m.type !== "notify") return;

    for (const msg of m.messages) {
      // Ignore if no message content or if sent by the bot itself
      if (!msg.message || msg.key.fromMe) continue;

      // Extract message text
      const messageText =
        msg.message.conversation ||
        msg.message.extendedTextMessage?.text ||
        msg.message.imageMessage?.caption ||
        "";

      // Check for /postdesmond command
      if (messageText.startsWith("/postdesmond")) {
        console.log("Detected /postdesmond command:", messageText);

        const parts = messageText.split(" ");
        // Expected format: /postdesmond {template} {phone}
        if (parts.length < 3) {
          console.log(
            "Invalid format. Expected: /postdesmond {template} {phone}",
          );
          // Optionally notify the user
          // await sock.sendMessage(msg.key.remoteJid, { text: "❌ Invalid format. Use: /postdesmond {template} {phone}" });
          continue;
        }

        const template = parts[1]; // e.g., template1
        const phoneNumber = parts[2]; // e.g., 60122273341

        console.log(
          `Processing Template: ${template} for Phone: ${phoneNumber}`,
        );

        let bodyContent = "";
        let buttons = [];

        // Logic for template1 (from image provided)
        if (template.toLowerCase() === "template1") {
          bodyContent =
            "Hello 👋 Thanks for reaching out JOMRewards.\n\nWe help F&B businesses bring old customers back automatically using WhatsApp loyalty & automation (no app download needed).\nBefore I share any details — are you currently running a business?";

          buttons = [
            {
              type: "quick_reply",
              name: "Yes, I own / manage a business",
              key: "yes",
            },
            {
              type: "quick_reply",
              name: "Planning to start",
              key: "planning",
            },
            {
              type: "quick_reply",
              name: "Just browsing",
              key: "browsing",
            },
          ];
        } else {
          // If template is not recognized, you can define default or skip
          console.log(`Template "${template}" not recognized.`);
          continue;
        }

        // Prepare the payload for JomRewards API
        const payload = {
          recipient_phone: phoneNumber,
          type: "body_with_buttons",
          message_body: bodyContent,
          buttons: buttons,
        };

        // Send the request
        try {
          const response = await axios.post(JOMREWARDS_API_URL, payload, {
            headers: {
              "X-API-Key": JOMREWARDS_API_KEY,
              "Content-Type": "application/json",
            },
          });

          console.log("JomRewards API Success:", response.data);

          // Notify the sender that it was successful
          await sock.sendMessage(msg.key.remoteJid, {
            text: `✅ Message sent successfully to ${phoneNumber} using ${template}.`,
          });
        } catch (apiError) {
          console.error(
            "JomRewards API Error:",
            apiError.response?.data || apiError.message,
          );
          // Notify the sender of the failure
          await sock.sendMessage(msg.key.remoteJid, {
            text: `❌ Error sending message: ${apiError.response?.data?.message || apiError.message}`,
          });
        }
      }
    }
  } catch (error) {
    console.error("Error in handler:", error);
  }
}
