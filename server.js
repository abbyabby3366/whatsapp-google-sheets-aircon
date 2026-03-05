// Polyfill for crypto if it's not global (needed for Baileys)
import crypto from "crypto";
if (typeof global.crypto === "undefined") {
  global.crypto = crypto.webcrypto;
}

import "dotenv/config";
import express from "express";
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  Browsers,
} from "@whiskeysockets/baileys";
import { useRedisAuthStateWithHSet } from "baileys-redis-auth";
import qrcode from "qrcode";
import http from "http";
import { Server as SocketIoServer } from "socket.io";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import pino from "pino";
import fs from "fs";
import qrcodeTerminal from "qrcode-terminal";
import multer from "multer";
import { jomrewards_api_send_message } from "./jomrewards_api_send_message.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage: storage });

// Logger
const logger = pino({ level: "info" });

const app = express();
const server = http.createServer(app);
const io = new SocketIoServer(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let sock = null;
let qrCodeData = null;
let clientStatus = "disconnected";

// Redis configuration
const redisOptions = {
  host: process.env.REDIS_HOST || "localhost",
  port: parseInt(process.env.REDIS_PORT || "6379"),
  password: process.env.REDIS_PASSWORD || undefined,
};
const sessionId = process.env.BAILEYS_AUTH_ID || "baileys_session";

async function connectToWhatsApp() {
  const { state, saveCreds } = await useRedisAuthStateWithHSet(
    redisOptions,
    sessionId,
  );
  const { version, isLatest } = await fetchLatestBaileysVersion();

  logger.info(`Using Baileys v${version.join(".")}, isLatest: ${isLatest}`);

  sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    browser: Browsers.macOS("Desktop"),
    logger,
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async (m) => {
    await jomrewards_api_send_message(sock, m);
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      logger.info("QR Code received");
      // Log QR in terminal
      qrcodeTerminal.generate(qr, { small: true });

      clientStatus = "qr_ready";
      try {
        qrCodeData = await qrcode.toDataURL(qr);
        io.emit("qr", { qr: qrCodeData });
        io.emit("status", { status: clientStatus });
      } catch (err) {
        logger.error("Error generating QR code:", err);
      }
    }

    if (connection === "close") {
      const shouldReconnect =
        lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
      logger.info(
        { error: lastDisconnect.error, reconnecting: shouldReconnect },
        "Connection closed",
      );
      clientStatus = "disconnected";
      io.emit("status", { status: clientStatus });
      if (shouldReconnect) {
        connectToWhatsApp();
      }
    } else if (connection === "open") {
      logger.info("WhatsApp connection opened successfully");
      clientStatus = "ready";
      qrCodeData = null;
      io.emit("status", { status: clientStatus });
    }
  });

  // We don't need any message handlers as per user request, just "send message" function.
}

// API Routes
app.get("/api/status", (req, res) => {
  res.json({
    status: clientStatus,
    qrCodeAvailable: !!qrCodeData,
    timestamp: new Date().toISOString(),
  });
});

app.get("/ping", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    whatsappStatus: clientStatus,
  });
});

app.get("/api/groups", async (req, res) => {
  try {
    if (clientStatus !== "ready" || !sock) {
      return res.status(400).json({ error: "WhatsApp client is not ready" });
    }

    const groups = await sock.groupFetchAllParticipating();
    const groupList = Object.values(groups).map((group) => ({
      id: group.id,
      subject: group.subject,
      isCommunity: group.isCommunity,
      isCommunityAnnouncement: group.isCommunityAnnounce,
    }));

    res.json({ success: true, groups: groupList });
  } catch (error) {
    logger.error("Error fetching groups:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch groups", details: error.message });
  }
});

app.get("/api/contacts", async (req, res) => {
  try {
    if (clientStatus !== "ready" || !sock) {
      return res.status(400).json({ error: "WhatsApp client is not ready" });
    }

    const contacts = (await sock.store?.contacts) || {};
    const contactList = Object.values(contacts)
      .filter((contact) => contact.id && !contact.id.includes("@g.us")) // Filter out groups
      .map((contact) => ({
        id: contact.id,
        name:
          contact.name || contact.notify || contact.verifiedName || "Unknown",
        number: contact.id.split("@")[0],
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({ contacts: contactList });
  } catch (error) {
    logger.error("Error fetching contacts:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch contacts", details: error.message });
  }
});

app.post("/api/send-message", upload.array("images"), async (req, res) => {
  console.log("Incoming POST request to /api/send-message:", req.body);
  try {
    const { number, message } = req.body;
    const files = req.files;

    if (!number) {
      return res.status(400).json({ error: "Number is required" });
    }

    if (!message && (!files || files.length === 0)) {
      return res.status(400).json({ error: "Message or images are required" });
    }

    if (clientStatus !== "ready" || !sock) {
      return res.status(400).json({ error: "WhatsApp client is not ready" });
    }

    // Format ID
    let formattedId = number.trim();

    // If it's already a group/community ID, leave it as is
    if (formattedId.endsWith("@g.us") || formattedId.endsWith("@newsletter")) {
      // Use as is
    } else {
      // Treat as a phone number
      formattedId = formattedId.replace(/[^\d]/g, "");
      if (!formattedId.endsWith("@s.whatsapp.net")) {
        formattedId += "@s.whatsapp.net";
      }
    }

    logger.info(`Sending message to: ${formattedId}`);

    // Send the text message first if it exists
    if (message) {
      await sock.sendMessage(formattedId, { text: message });
    }

    // Send each image
    if (files && files.length > 0) {
      for (const file of files) {
        await sock.sendMessage(formattedId, {
          image: { url: file.path },
          caption: "", // You can choose to add a caption here if needed
        });
        // Delete the file after sending
        fs.unlinkSync(file.path);
      }
    }

    res.json({
      success: true,
      message: `Successfully sent ${message ? "message" : ""} ${files.length > 0 ? "and " + files.length + " image(s)" : ""}`,
    });
  } catch (error) {
    logger.error("Error sending message:", error);
    res
      .status(500)
      .json({ error: "Failed to send message", details: error.message });
  }
});

// External API endpoint for sending messages (can be called from outside)
app.post("/api/external/send-message", async (req, res) => {
  try {
    const { number, message } = req.body;

    if (!number) {
      return res.status(400).json({ error: "Number is required" });
    }

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    if (clientStatus !== "ready" || !sock) {
      return res.status(400).json({ error: "WhatsApp client is not ready" });
    }

    // Format phone number or group JID
    let formattedId = number.trim();

    // If it's already a group/community ID, leave it as is
    if (formattedId.endsWith("@g.us") || formattedId.endsWith("@newsletter")) {
      // Use as is
    } else {
      // Treat as a phone number
      if (formattedId.startsWith("+")) {
        formattedId = formattedId.substring(1);
      }
      formattedId = formattedId.replace(/[^\d]/g, "");
      if (!formattedId.endsWith("@s.whatsapp.net")) {
        formattedId += "@s.whatsapp.net";
      }
    }

    logger.info(`Sending external message to: ${formattedId}`);

    // Send the message
    const result = await sock.sendMessage(formattedId, { text: message });

    res.json({
      success: true,
      message: "Message sent successfully",
      messageId: result.key.id,
      recipient: number,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Error sending external message:", error);
    res
      .status(500)
      .json({ error: "Failed to send message", details: error.message });
  }
});

app.post("/otp", async (req, res) => {
  try {
    console.log("OTP webhook received:", req.body);

    // Extract data from testOTP structure
    const testOTP = req.body;
    console.log("Received testOTP:", JSON.stringify(testOTP, null, 2));

    const phoneNumber = testOTP.to;
    // Extract OTP from the first parameter of the first component (BODY)
    const otp =
      testOTP.extendedMessage?.whatsappCloudApiTemplateMessageObject
        ?.components?.[0]?.parameters?.[0]?.text;
    const sessionId = testOTP.sessionId || "test-session";

    console.log("Extracted phoneNumber:", phoneNumber);
    console.log("Extracted otp:", otp);

    if (!phoneNumber || !otp) {
      return res.status(400).json({
        success: false,
        error: "Invalid testOTP structure - missing to or OTP text",
        debug: {
          phoneNumber: phoneNumber,
          otp: otp,
          receivedBody: testOTP,
        },
      });
    }

    if (clientStatus !== "ready" || !sock) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp client is not ready",
      });
    }

    // Format phone number (remove + if present and add @s.whatsapp.net suffix for Baileys)
    let formattedNumber = phoneNumber.replace("+", "").replace(/[^\d]/g, "");
    if (!formattedNumber.endsWith("@s.whatsapp.net")) {
      formattedNumber += "@s.whatsapp.net";
    }

    // Create OTP message with the specified format
    const otpMessage = `*${otp}* is your verification code. For your security, do not share this code.`;

    // Send OTP message
    const result = await sock.sendMessage(formattedNumber, {
      text: otpMessage,
    });

    console.log("OTP message sent successfully:", {
      sessionId,
      phoneNumber,
      otp,
      messageId: result.key.id,
    });

    res.json({
      success: true,
      messageId: result.key.id,
      sessionId: sessionId,
      otp: otp,
      phoneNumber: phoneNumber,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in OTP webhook:", error);
    res.status(500).json({
      success: false,
      error: "Failed to send OTP message",
      details: error.message,
    });
  }
});

app.post("/initiate", async (req, res) => {
  try {
    console.log("Initiate webhook received:", req.body);

    // Extract data from testData structure
    const testData = req.body;
    const phoneNumber = testData.phone_number;
    const sessionId = testData.sessionId || "test-session";
    const messageType = testData.messageType || "text";
    const mediaUrl = testData.message; // From the snippet, 'message' field is used for media URLs

    // Reservation details
    const fullName = testData.BP_fullname;
    const bpId = testData.BP_ID;
    const bookingId = testData.booking_id;
    const merchantName = testData.merchant_name;
    const commissionRate = testData.commission_rate;
    const reservationDate = testData.reservation_date;
    const reservationTime = testData.reservation_time;
    const numberOfGuests = testData.number_of_guests;
    const remarks = testData.remarks || "No special requests";

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        error: "Phone number is required",
      });
    }

    if (clientStatus !== "ready" || !sock) {
      return res.status(400).json({
        success: false,
        error: "WhatsApp client is not ready",
      });
    }

    // Format phone number (remove + if present and add @s.whatsapp.net suffix for Baileys)
    let formattedNumber = phoneNumber.replace("+", "").replace(/[^\d]/g, "");
    if (!formattedNumber.endsWith("@s.whatsapp.net")) {
      formattedNumber += "@s.whatsapp.net";
    }

    // Create reservation confirmation message using the template
    const reservationMessage = `*Hi, ${fullName || "Guest"} (ID: ${bpId || "N/A"})*

Thank you for choosing Jio8 😎

To confirm the details of your reservation, please review the information below:

• Booking ID: ${bookingId || "N/A"}
• Merchant: ${merchantName || "N/A"}
• Commission Rate: ${commissionRate || "N/A"}
• Reservation Date: ${reservationDate || "N/A"}
• Reservation Time: ${reservationTime || "N/A"}
• Number of Guests: ${numberOfGuests || "N/A"}
• Remarks: ${remarks}

If the information above is correct, please reply "*Yes*" to proceed.

Jio8 Customer Support`;

    console.log(
      `[Initiate] Preparing to send ${messageType} message to ${formattedNumber}`,
    );
    console.log(`[Initiate] Message Content:\n${reservationMessage}`);

    let result;

    // Handle different message types using Baileys logic
    switch (messageType.toLowerCase()) {
      case "text":
        result = await sock.sendMessage(formattedNumber, {
          text: reservationMessage,
        });
        break;
      case "image":
        if (!mediaUrl) throw new Error("Image URL is required for image type");
        result = await sock.sendMessage(formattedNumber, {
          image: { url: mediaUrl },
          caption: reservationMessage,
        });
        break;
      case "document":
        if (!mediaUrl)
          throw new Error("Document URL is required for document type");
        result = await sock.sendMessage(formattedNumber, {
          document: { url: mediaUrl },
          mimetype: "application/pdf", // Defaulting to PDF
          fileName: "Reservation_Details.pdf",
          caption: reservationMessage,
        });
        break;
      default:
        result = await sock.sendMessage(formattedNumber, {
          text: reservationMessage,
        });
    }

    console.log("Initiate message sent successfully:", {
      sessionId,
      phoneNumber,
      messageType,
      fullName,
      bookingId,
      messageId: result.key.id,
    });

    res.json({
      success: true,
      messageId: result.key.id,
      sessionId: sessionId || null,
      messageType,
      bookingId: bookingId || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Error in Initiate webhook:", error);
    res.status(500).json({
      success: false,
      error: "Failed to send initiate message",
      details: error.message,
    });
  }
});

// Serve the main HTML page
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// Socket.IO connection handling
io.on("connection", (socket) => {
  socket.emit("status", { status: clientStatus });
  if (qrCodeData) {
    socket.emit("qr", { qr: qrCodeData });
  }
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
  console.log("Server running on http://localhost:8080");
  connectToWhatsApp();
});
