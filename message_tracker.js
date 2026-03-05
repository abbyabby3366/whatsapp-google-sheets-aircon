import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BLACKLIST_FILE = path.join(__dirname, "blacklist.json");
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL;

/**
 * Loads data from a JSON file. Returns defaultVal if file doesn't exist or is invalid.
 */
function loadJSON(filePath, defaultVal = []) {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.error(`Error loading ${filePath}:`, error);
  }
  return defaultVal;
}

/**
 * Saves data to a JSON file.
 */
function saveJSON(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error(`Error saving ${filePath}:`, error);
  }
}

/**
 * Tracks an incoming message if it's a personal chat and not blacklisted.
 * Sends data to Google Sheets and syncs the blacklist.
 * @param {import('@whiskeysockets/baileys').WASocket} sock
 * @param {any} m
 */
export async function trackMessage(sock, m) {
  try {
    if (m.type !== "notify") return;
    if (!GOOGLE_SCRIPT_URL) {
      console.warn("[Tracker] GOOGLE_SCRIPT_URL is not defined in .env");
      return;
    }

    const localBlacklist = loadJSON(BLACKLIST_FILE, []);

    for (const msg of m.messages) {
      const remoteJid = msg.key.remoteJid;

      // Only process personal messages (not groups/broadcasts/etc)
      if (!remoteJid || !remoteJid.endsWith("@s.whatsapp.net")) continue;

      // Skip messages sent by the bot itself
      if (msg.key.fromMe) continue;

      const phoneNumber = remoteJid.split("@")[0];

      // Check if number is blacklisted locally
      if (localBlacklist.includes(phoneNumber)) {
        console.log(`[Tracker] Skipping blacklisted number: ${phoneNumber}`);
        continue;
      }

      const name = msg.pushName || "Unknown";
      const timestamp = new Date(
        (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000,
      ).toISOString();

      try {
        console.log(
          `[Tracker] Sending lead to Google Sheets: ${phoneNumber} (${name})`,
        );
        const response = await axios.post(GOOGLE_SCRIPT_URL, {
          phone: phoneNumber,
          name: name,
          timestamp: timestamp,
        });

        if (response.data && response.data.success) {
          console.log(`[Tracker] Successfully tracked lead for ${phoneNumber}`);

          // Update local blacklist with the one returned from GAS
          if (Array.isArray(response.data.blacklist)) {
            const newBlacklist = response.data.blacklist;
            saveJSON(BLACKLIST_FILE, newBlacklist);
            console.log(
              `[Tracker] Local blacklist updated with ${newBlacklist.length} numbers.`,
            );
          }
        } else {
          console.error(
            `[Tracker] Google Script returned error:`,
            response.data.error || "Unknown error",
          );
        }
      } catch (apiError) {
        console.error(
          `[Tracker] Error calling Google Script:`,
          apiError.message,
        );
      }
    }
  } catch (error) {
    console.error("[Tracker] Error in tracking loop:", error);
  }
}
