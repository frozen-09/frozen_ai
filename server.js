require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { DatabaseSync } = require("node:sqlite");


// =========================================
// LOGGING
// =========================================

function logInfo(message, data) {

    const line =
        "[" + new Date().toISOString() + "] [INFO] " + message;

    if (data !== undefined) {
        console.log(line, data);
    } else {
        console.log(line);
    }
}

function logWarn(message, data) {

    const line =
        "[" + new Date().toISOString() + "] [WARN] " + message;

    if (data !== undefined) {
        console.warn(line, data);
    } else {
        console.warn(line);
    }
}

function logError(message, error) {

    const line =
        "[" + new Date().toISOString() + "] [ERROR] " + message;

    if (error) {
        console.error(line, error.message || error);
    } else {
        console.error(line);
    }
}


// =========================================
// REQUIRED ENV VARS
// =========================================

const REQUIRED_ENV_VARS = [
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "JWT_SECRET",
    "VIRUSTOTAL_API_KEY"
];

const missingVars =
    REQUIRED_ENV_VARS.filter(function (key) {
        return !process.env[key] || process.env[key].trim() === "";
    });

if (missingVars.length > 0) {

    console.error(
        "FATAL: Missing required environment variables: " +
        missingVars.join(", ")
    );

    console.error(
        "Add them to your .env file before starting the server."
    );

    process.exit(1);
}


// =========================================
// APP SETUP
// =========================================

const app = express();

app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const DB_FILE = process.env.DB_FILE || "./nani.db";


// =========================================
// DATABASE
// =========================================

const db = new DatabaseSync(DB_FILE);

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        passwordHash TEXT NOT NULL,
        createdAt TEXT NOT NULL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS user_data (
        userId TEXT PRIMARY KEY,
        conversationHistory TEXT NOT NULL DEFAULT '[]',
        profile TEXT NOT NULL DEFAULT '{}'
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS ctf_sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        challengeName TEXT NOT NULL,
        category TEXT,
        description TEXT,
        clues TEXT NOT NULL DEFAULT '[]',
        failedApproaches TEXT NOT NULL DEFAULT '[]',
        chatHistory TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT 'active',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT 'New Chat',
        messages TEXT NOT NULL DEFAULT '[]',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS authorized_targets (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        target TEXT NOT NULL,
        authorizationStatement TEXT NOT NULL,
        isKnownLab INTEGER NOT NULL DEFAULT 0,
        confirmedAt TEXT NOT NULL,
        expiresAt TEXT
    )
`);

db.exec(`
    CREATE TABLE IF NOT EXISTS ctf_files (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        sessionId TEXT NOT NULL,
        filename TEXT NOT NULL,
        mimeType TEXT,
        sizeBytes INTEGER NOT NULL,
        dataBase64 TEXT NOT NULL,
        uploadedAt TEXT NOT NULL
    )
`);

console.log("Database ready:", DB_FILE);


// =========================================
// PERSONALITIES
// =========================================

const NANI_PERSONALITY = `
You are NANI AI, a personal AI assistant.

Your name is NANI AI.

Your personality:
- Friendly
- Helpful
- Clear
- Professional when needed
- Patient
- Explain difficult topics in simple language
- Give practical step-by-step instructions
- Do not pretend to know something you do not know

You are helping the user build and use NANI AI.

Use the conversation and saved memory when relevant.

Never reveal API keys, passwords, tokens, or other private credentials.

If the user asks who you are, identify yourself as NANI AI.

Keep answers reasonably concise unless the user asks for detailed information.
`;

const CTF_PERSONALITY = `
You are NANI AI operating in CTF (Capture The Flag) assistant mode.

Your role: help the user analyze CTF challenges in authorized environments only (CTF competitions, training labs, their own systems). Never assist with attacks on real-world targets without explicit authorization context.

Your approach:
1. If the challenge category is unclear, ask clarifying questions before diving in.
2. Identify the likely vulnerability class or technique category (web, crypto, forensics, reverse engineering, malware, OSINT, steganography, mobile, binary exploitation, misc).
3. Build a clear hypothesis before suggesting actions.
4. Recommend specific tools (e.g. Burp Suite, Wireshark, Ghidra, pwntools) and explain commands before the user runs them — never just dump a command with no explanation.
5. When the user shares command output, analyze it carefully and connect it to the hypothesis.
6. Track discovered clues and avoid repeating approaches that already failed — refer back to what's already been tried in this session.
7. Help build a structured path toward the solution, not just isolated answers.
8. If the user shares a candidate flag, help validate it against the expected format (e.g. flag{...}, CTF{...}) but never fabricate a flag.
9. Once solved, explain the full solution clearly and how each step connected.

Stay technical, precise, and practical. Assume the user has some technical background but explain non-obvious tools or concepts.

TOOL GUIDANCE (explain and recommend only — you do not execute tools yourself):

Burp Suite: Guide the user through intercepting requests in the Proxy tab, using Repeater to modify and resend requests, Intruder for automated parameter fuzzing, and Decoder for encoding/decoding payloads. When they paste a request/response, analyze headers, cookies, parameters, and any reflected input for injection points.

Nmap: Recommend specific scan types based on their goal — e.g. "nmap -sV -p- <target>" for full port + version detection, "-sC" for default scripts, "-A" for aggressive OS/service detection. Explain what each flag does before suggesting it. When they paste scan output, identify open ports, likely services, and what each might mean for the challenge.

Metasploit: Explain module selection (search, use, show options, set RHOSTS, etc.) conceptually and help them understand what a given exploit/auxiliary module does before running it. When they share msfconsole output, help interpret success/failure and next steps.

Always explain WHY a tool or command is appropriate for the current hypothesis, not just WHAT to type. If the user pastes raw tool output, read it carefully and connect findings back to the challenge's goal.

Never provide assistance that would only make sense against a real, unauthorized system — always frame guidance around the CTF/lab context.
`;


// =========================================
// MIDDLEWARE
// =========================================

const allowedOrigins = [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://localhost:8158",
    "http://127.0.0.1:8158",
    "https://nani-ai-frontend.onrender.com"
];

app.use(helmet());

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error: "Too many attempts. Please try again in 15 minutes." },
    standardHeaders: true,
    legacyHeaders: false
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { success: false, error: "Too many requests. Please slow down." },
    standardHeaders: true,
    legacyHeaders: false
});

app.use(cors({
    origin: function (origin, callback) {

        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    }
}));

app.use(express.json({ limit: "50mb" }));


// =========================================
// USER FUNCTIONS
// =========================================

function findUserByUsername(username) {

    const row =
        db.prepare("SELECT * FROM users WHERE username = ?").get(username);

    return row || null;
}

function createUser(id, username, passwordHash, createdAt) {

    db.prepare(
        "INSERT INTO users (id, username, passwordHash, createdAt) VALUES (?, ?, ?, ?)"
    ).run(id, username, passwordHash, createdAt);
}


// =========================================
// PER-USER DATA (chat history + profile)
// =========================================

function loadUserData(userId) {

    const row =
        db.prepare("SELECT * FROM user_data WHERE userId = ?").get(userId);

    if (!row) {

        return { conversationHistory: [], profile: {} };
    }

    return {
        conversationHistory: JSON.parse(row.conversationHistory),
        profile: JSON.parse(row.profile)
    };
}

function saveUserData(userId, userData) {

    const conversationJson = JSON.stringify(userData.conversationHistory);
    const profileJson = JSON.stringify(userData.profile);

    db.prepare(`
        INSERT INTO user_data (userId, conversationHistory, profile)
        VALUES (?, ?, ?)
        ON CONFLICT(userId) DO UPDATE SET
            conversationHistory = excluded.conversationHistory,
            profile = excluded.profile
    `).run(userId, conversationJson, profileJson);
}

function updateProfileFromMessage(userMessage, userProfile) {

    const text = userMessage.trim();

    const nameMatch =
        text.match(/(?:my name is|i am|i'm)\s+([a-zA-Z][a-zA-Z ]{1,30})/i);

    if (nameMatch) {

        userProfile.name = nameMatch[1].trim();
        logInfo("Memory updated: name = " + userProfile.name);
    }

    const interestMatch =
        text.match(/(?:i like|i love|i am interested in|my interest is)\s+(.+)/i);

    if (interestMatch) {

        const interest = interestMatch[1].trim();

        if (!userProfile.interests) {
            userProfile.interests = [];
        }

        if (!userProfile.interests.includes(interest)) {

            userProfile.interests.push(interest);
            logInfo("Memory updated: interest = " + interest);
        }
    }

    const languageMatch =
        text.match(/(?:my favorite programming language is|my favourite programming language is)\s+([a-zA-Z0-9+#]+)/i);

    if (languageMatch) {

        userProfile.favorite_language = languageMatch[1].trim();
        logInfo("Memory updated: favorite language = " + userProfile.favorite_language);
    }
}


// =========================================
// CTF SESSIONS
// =========================================

function createCtfSession(userId, challengeName, category, description) {

    const id = Date.now().toString();
    const now = new Date().toISOString();

    db.prepare(`
        INSERT INTO ctf_sessions
        (id, userId, challengeName, category, description, clues, failedApproaches, chatHistory, status, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, '[]', '[]', '[]', 'active', ?, ?)
    `).run(id, userId, challengeName, category || null, description || null, now, now);

    return id;
}

function listCtfSessions(userId) {

    return db.prepare(`
        SELECT id, challengeName, category, status, createdAt, updatedAt
        FROM ctf_sessions
        WHERE userId = ?
        ORDER BY updatedAt DESC
    `).all(userId);
}

function getCtfSession(userId, sessionId) {

    const row =
        db.prepare(`SELECT * FROM ctf_sessions WHERE id = ? AND userId = ?`)
            .get(sessionId, userId);

    if (!row) {
        return null;
    }

    return {
        id: row.id,
        challengeName: row.challengeName,
        category: row.category,
        description: row.description,
        clues: JSON.parse(row.clues),
        failedApproaches: JSON.parse(row.failedApproaches),
        chatHistory: JSON.parse(row.chatHistory),
        status: row.status,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}

function updateCtfSession(userId, sessionId, updates) {

    const session = getCtfSession(userId, sessionId);

    if (!session) {
        return false;
    }

    const merged = { ...session, ...updates };

    db.prepare(`
        UPDATE ctf_sessions
        SET clues = ?, failedApproaches = ?, chatHistory = ?, status = ?, updatedAt = ?
        WHERE id = ? AND userId = ?
    `).run(
        JSON.stringify(merged.clues),
        JSON.stringify(merged.failedApproaches),
        JSON.stringify(merged.chatHistory),
        merged.status,
        new Date().toISOString(),
        sessionId,
        userId
    );

    return true;
}

function deleteCtfSession(userId, sessionId) {

    const result =
        db.prepare(`DELETE FROM ctf_sessions WHERE id = ? AND userId = ?`)
            .run(sessionId, userId);

    return result.changes > 0;
}


// =========================================
// CONVERSATIONS (multiple chat threads)
// =========================================

function createConversation(userId, title) {

    const id = Date.now().toString();
    const now = new Date().toISOString();

    db.prepare(`
        INSERT INTO conversations (id, userId, title, messages, createdAt, updatedAt)
        VALUES (?, ?, ?, '[]', ?, ?)
    `).run(id, userId, title || "New Chat", now, now);

    return id;
}

function listConversations(userId) {

    return db.prepare(`
        SELECT id, title, createdAt, updatedAt
        FROM conversations
        WHERE userId = ?
        ORDER BY updatedAt DESC
    `).all(userId);
}

function getConversation(userId, conversationId) {

    const row =
        db.prepare(`SELECT * FROM conversations WHERE id = ? AND userId = ?`)
            .get(conversationId, userId);

    if (!row) {
        return null;
    }

    return {
        id: row.id,
        title: row.title,
        messages: JSON.parse(row.messages),
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}

function saveConversationMessages(userId, conversationId, messages) {

    db.prepare(`
        UPDATE conversations SET messages = ?, updatedAt = ?
        WHERE id = ? AND userId = ?
    `).run(JSON.stringify(messages), new Date().toISOString(), conversationId, userId);
}

function deleteConversation(userId, conversationId) {

    const result =
        db.prepare(`DELETE FROM conversations WHERE id = ? AND userId = ?`)
            .run(conversationId, userId);

    return result.changes > 0;
}

function renameConversation(userId, conversationId, newTitle) {

    const result =
        db.prepare(`UPDATE conversations SET title = ? WHERE id = ? AND userId = ?`)
            .run(newTitle, conversationId, userId);

    return result.changes > 0;
}


// =========================================
// AUTHORIZED TARGETS
// =========================================

const KNOWN_LAB_DOMAINS = [
    "tryhackme.com",
    "hackthebox.com",
    "hackthebox.eu",
    "picoctf.org",
    "overthewire.org",
    "portswigger.net",
    "dvwa.co.uk",
    "bwapp.me",
    "vulnweb.com",
    "testphp.vulnweb.com",
    "hacker101.com",
    "ctftime.org"
];

function isKnownLabDomain(target) {

    const lower = target.toLowerCase();

    return KNOWN_LAB_DOMAINS.some(function (lab) {
        return lower.includes(lab);
    });
}

function declareAuthorizedTarget(userId, target, authorizationStatement) {

    const id = Date.now().toString();
    const now = new Date().toISOString();
    const knownLab = isKnownLabDomain(target);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.prepare(`
        INSERT INTO authorized_targets
        (id, userId, target, authorizationStatement, isKnownLab, confirmedAt, expiresAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, target.toLowerCase().trim(), authorizationStatement, knownLab ? 1 : 0, now, expiresAt);

    logInfo("Authorized target declared", { userId: userId, target: target, knownLab: knownLab });

    return { id: id, isKnownLab: knownLab, expiresAt: expiresAt };
}

function getActiveAuthorizedTargets(userId) {

    return db.prepare(`
        SELECT * FROM authorized_targets
        WHERE userId = ? AND (expiresAt IS NULL OR expiresAt > ?)
        ORDER BY confirmedAt DESC
    `).all(userId, new Date().toISOString());
}


// =========================================
// CTF FILE UPLOADS
// =========================================

const MAX_CTF_FILE_SIZE = 15 * 1024 * 1024;

function storeCtfFile(userId, sessionId, filename, mimeType, base64Data) {

    const approxBytes = (base64Data.length * 3) / 4;

    if (approxBytes > MAX_CTF_FILE_SIZE) {

        throw new Error("File too large. Maximum size is 15MB.");
    }

    const id = Date.now().toString();

    db.prepare(`
        INSERT INTO ctf_files (id, userId, sessionId, filename, mimeType, sizeBytes, dataBase64, uploadedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, userId, sessionId, filename, mimeType || "application/octet-stream", Math.round(approxBytes), base64Data, new Date().toISOString());

    return id;
}

function listCtfFiles(userId, sessionId) {

    return db.prepare(`
        SELECT id, filename, mimeType, sizeBytes, uploadedAt
        FROM ctf_files
        WHERE userId = ? AND sessionId = ?
        ORDER BY uploadedAt DESC
    `).all(userId, sessionId);
}

function getCtfFile(userId, fileId) {

    return db.prepare(`SELECT * FROM ctf_files WHERE id = ? AND userId = ?`)
        .get(fileId, userId) || null;
}


// =========================================
// AUTH MIDDLEWARE
// =========================================

function requireAuth(req, res, next) {

    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {

        return res.status(401).json({ success: false, error: "Authentication required." });
    }

    const token = authHeader.split(" ")[1];

    try {

        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        req.user = decoded;
        next();

    } catch (error) {

        return res.status(401).json({ success: false, error: "Invalid or expired token." });
    }
}


// =========================================
// TEST / HEALTH
// =========================================

app.get("/", (req, res) => {

    res.json({ success: true, message: "NANI AI backend is working!" });
});

app.get("/api/health", (req, res) => {

    let dbStatus = "ok";

    try {

        db.prepare("SELECT 1").get();

    } catch (error) {

        dbStatus = "error";
    }

    res.json({
        success: true,
        status: "ok",
        database: dbStatus,
        uptimeSeconds: process.uptime(),
        timestamp: new Date().toISOString()
    });
});


// =========================================
// GEMINI (non-streaming)
// =========================================

async function askGemini(history, userProfile) {

    const url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY;

    const recentHistory = history.slice(-20);

    const geminiHistory = recentHistory.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
    }));

    const profileText = JSON.stringify(userProfile || {}, null, 2);

    const contents = [
        {
            role: "user",
            parts: [{
                text:
                    NANI_PERSONALITY +
                    "\n\nLONG-TERM USER MEMORY:\n" +
                    profileText +
                    "\n\nUse this memory when relevant. Do not reveal private credentials."
            }]
        },
        ...geminiHistory
    ];

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: contents })
    });

    if (!response.ok) {

        let errorMessage = "Gemini request failed";

        try {

            const errorData = await response.json();

            if (errorData.error && errorData.error.message) {
                errorMessage = errorData.error.message;
            }

        } catch (parseError) {

            errorMessage = "Gemini HTTP " + response.status;
        }

        throw new Error("Gemini failed: " + response.status + " - " + errorMessage);
    }

    const data = await response.json();

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {

        throw new Error("Gemini returned an invalid response");
    }

    return data.candidates[0].content.parts[0].text;
}


// =========================================
// GEMINI (streaming)
// =========================================

async function askGeminiStream(history, userProfile, res) {

    const url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse&key=" +
        process.env.GEMINI_API_KEY;

    const recentHistory = history.slice(-20);

    const geminiHistory = recentHistory.map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
    }));

    const profileText = JSON.stringify(userProfile || {}, null, 2);

    const contents = [
        {
            role: "user",
            parts: [{
                text:
                    NANI_PERSONALITY +
                    "\n\nLONG-TERM USER MEMORY:\n" +
                    profileText +
                    "\n\nUse this memory when relevant. Do not reveal private credentials."
            }]
        },
        ...geminiHistory
    ];

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: contents })
    });

    if (!response.ok) {

        throw new Error("Gemini stream failed: " + response.status);
    }

    let fullText = "";

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {

        const { done, value } = await reader.read();

        if (done) {
            break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {

            if (!line.startsWith("data: ")) {
                continue;
            }

            const jsonStr = line.slice(6).trim();

            if (!jsonStr || jsonStr === "[DONE]") {
                continue;
            }

            try {

                const parsed = JSON.parse(jsonStr);

                const chunk =
                    parsed.candidates &&
                    parsed.candidates[0] &&
                    parsed.candidates[0].content &&
                    parsed.candidates[0].content.parts &&
                    parsed.candidates[0].content.parts[0] &&
                    parsed.candidates[0].content.parts[0].text;

                if (chunk) {

                    fullText += chunk;

                    res.write("data: " + JSON.stringify({ chunk: chunk }) + "\n\n");
                }

            } catch (parseErr) {
                // skip malformed chunk
            }
        }
    }

    return fullText;
}


// =========================================
// OPENROUTER FALLBACK
// =========================================

async function askOpenRouter(history, userProfile) {

    const profileText = JSON.stringify(userProfile || {}, null, 2);

    const recentHistory = history.slice(-20);

    const messages = [
        {
            role: "system",
            content:
                NANI_PERSONALITY +
                "\n\nLONG-TERM USER MEMORY:\n" +
                profileText +
                "\n\nUse this memory when relevant. Do not reveal private credentials."
        },
        ...recentHistory
    ];

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Authorization": "Bearer " + process.env.OPENROUTER_API_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ model: "openrouter/free", messages: messages })
    });

    if (!response.ok) {

        let errorMessage = "OpenRouter request failed";

        try {

            const errorData = await response.json();

            if (errorData.error && errorData.error.message) {
                errorMessage = errorData.error.message;
            }

        } catch (parseError) {

            errorMessage = "OpenRouter HTTP " + response.status;
        }

        throw new Error("OpenRouter failed: " + response.status + " - " + errorMessage);
    }

    const data = await response.json();

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {

        throw new Error("OpenRouter returned an invalid response");
    }

    return data.choices[0].message.content;
}


// =========================================
// IMAGE AI
// =========================================

async function askGeminiImage(message, imageData) {

    const url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY;

    const parts = [];

    parts.push({ text: NANI_PERSONALITY + "\n\nUser question:\n" + message });

    parts.push({
        inline_data: {
            mime_type: imageData.mimeType,
            data: imageData.base64
        }
    });

    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: parts }] })
    });

    if (!response.ok) {

        throw new Error("Gemini image failed: " + response.status);
    }

    const data = await response.json();

    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content) {

        throw new Error("Gemini image returned invalid response");
    }

    return data.candidates[0].content.parts[0].text;
}

app.post(
    "/api/image",
    requireAuth,
    apiLimiter,
    async (req, res) => {

        const message = req.body.message || "Describe this image.";
        const image = req.body.image;

        if (!image || typeof image !== "string") {

            return res.status(400).json({ success: false, error: "Image is required" });
        }

        const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

        const mimeMatch = image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);

        if (!mimeMatch) {

            return res.status(400).json({ success: false, error: "Invalid image format." });
        }

        if (!ALLOWED_IMAGE_TYPES.includes(mimeMatch[1])) {

            return res.status(400).json({ success: false, error: "Unsupported image type. Use JPEG, PNG, or WEBP." });
        }

        const approxSizeBytes = (image.length * 3) / 4;

        if (approxSizeBytes > 8 * 1024 * 1024) {

            return res.status(400).json({ success: false, error: "Image is too large. Maximum size is 8MB." });
        }

        logInfo("Image request received.");

        try {

            let base64Data = image;
            let mimeType = "image/jpeg";

            const match = image.match(/^data:(.+?);base64,(.+)$/);

            if (match) {

                mimeType = match[1];
                base64Data = match[2];
            }

            const answer = await askGeminiImage(message, { mimeType: mimeType, base64: base64Data });

            logInfo("Image response received.");

            res.json({ success: true, provider: "Gemini", response: answer });

        } catch (error) {

            logError("Image AI failed", error);

            res.status(500).json({ success: false, error: "NANI AI could not analyze the image." });
        }
    }
);


// =========================================
// AUTH: SIGNUP
// =========================================

app.post(
    "/api/signup",
    authLimiter,
    async (req, res) => {

        const username = req.body.username;
        const password = req.body.password;

        if (!username || typeof username !== "string" || username.trim().length < 3) {

            return res.status(400).json({ success: false, error: "Username must be at least 3 characters." });
        }

        if (!password || typeof password !== "string" || password.length < 6) {

            return res.status(400).json({ success: false, error: "Password must be at least 6 characters." });
        }

        const cleanUsername = username.trim().toLowerCase();

        const existingUser = findUserByUsername(cleanUsername);

        if (existingUser) {

            return res.status(409).json({ success: false, error: "Username already exists." });
        }

        try {

            const passwordHash = await bcrypt.hash(password, 10);
            const newUserId = Date.now().toString();

            createUser(newUserId, cleanUsername, passwordHash, new Date().toISOString());

            logInfo("New user created: " + cleanUsername);

            res.json({ success: true, message: "Account created successfully. Please log in." });

        } catch (error) {

            logError("Signup error", error);

            res.status(500).json({ success: false, error: "Could not create account." });
        }
    }
);


// =========================================
// AUTH: LOGIN
// =========================================

app.post(
    "/api/login",
    authLimiter,
    async (req, res) => {

        const username = req.body.username;
        const password = req.body.password;

        if (!username || !password || typeof username !== "string" || typeof password !== "string") {

            return res.status(400).json({ success: false, error: "Username and password are required." });
        }

        const cleanUsername = username.trim().toLowerCase();

        const user = findUserByUsername(cleanUsername);

        if (!user) {

            return res.status(401).json({ success: false, error: "Invalid username or password." });
        }

        try {

            const passwordMatches = await bcrypt.compare(password, user.passwordHash);

            if (!passwordMatches) {

                return res.status(401).json({ success: false, error: "Invalid username or password." });
            }

            const token = jwt.sign(
                { userId: user.id, username: user.username },
                process.env.JWT_SECRET,
                { expiresIn: "7d" }
            );

            logInfo("User logged in: " + user.username);

            res.json({ success: true, token: token, username: user.username });

        } catch (error) {

            logError("Login error", error);

            res.status(500).json({ success: false, error: "Login failed." });
        }
    }
);


// =========================================
// SECURITY TOOL APIS
// =========================================

async function lookupCVE(cveId) {

    const cleanId = cveId.trim().toUpperCase();

    const url = "https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=" + cleanId;

    const response = await fetch(url);

    if (!response.ok) {

        throw new Error("NVD lookup failed: " + response.status);
    }

    const data = await response.json();

    if (!data.vulnerabilities || data.vulnerabilities.length === 0) {

        return null;
    }

    const cve = data.vulnerabilities[0].cve;

    const description = cve.descriptions.find(d => d.lang === "en");

    const metrics =
        cve.metrics && (cve.metrics.cvssMetricV31 || cve.metrics.cvssMetricV30 || cve.metrics.cvssMetricV2);

    const severity =
        metrics && metrics[0]
            ? metrics[0].cvssData.baseScore + " (" + (metrics[0].cvssData.baseSeverity || "N/A") + ")"
            : "N/A";

    return {
        id: cve.id,
        description: description ? description.value : "No description available.",
        severity: severity,
        published: cve.published
    };
}

app.get(
    "/api/tools/cve/:id",
    requireAuth,
    apiLimiter,
    async (req, res) => {

        try {

            const result = await lookupCVE(req.params.id);

            if (!result) {

                return res.status(404).json({ success: false, error: "CVE not found." });
            }

            res.json({ success: true, cve: result });

        } catch (error) {

            logError("CVE lookup failed", error);

            res.status(500).json({ success: false, error: "Could not fetch CVE data." });
        }
    }
);

async function scanUrlVirusTotal(targetUrl) {

    const submitResponse = await fetch("https://www.virustotal.com/api/v3/urls", {
        method: "POST",
        headers: {
            "x-apikey": process.env.VIRUSTOTAL_API_KEY,
            "Content-Type": "application/x-www-form-urlencoded"
        },
        body: "url=" + encodeURIComponent(targetUrl)
    });

    if (!submitResponse.ok) {

        throw new Error("VirusTotal submission failed: " + submitResponse.status);
    }

    const submitData = await submitResponse.json();
    const analysisId = submitData.data.id;

    const resultResponse = await fetch("https://www.virustotal.com/api/v3/analyses/" + analysisId, {
        headers: { "x-apikey": process.env.VIRUSTOTAL_API_KEY }
    });

    if (!resultResponse.ok) {

        throw new Error("VirusTotal result fetch failed: " + resultResponse.status);
    }

    const resultData = await resultResponse.json();
    const stats = resultData.data.attributes.stats;

    return {
        url: targetUrl,
        malicious: stats.malicious,
        suspicious: stats.suspicious,
        harmless: stats.harmless,
        undetected: stats.undetected,
        status: resultData.data.attributes.status
    };
}

app.post(
    "/api/tools/virustotal",
    requireAuth,
    apiLimiter,
    async (req, res) => {

        const targetUrl = req.body.url;

        if (!targetUrl || typeof targetUrl !== "string") {

            return res.status(400).json({ success: false, error: "url is required." });
        }

        try {

            const result = await scanUrlVirusTotal(targetUrl);

            res.json({ success: true, result: result });

        } catch (error) {

            logError("VirusTotal scan failed", error);

            res.status(500).json({ success: false, error: "VirusTotal scan failed." });
        }
    }
);


// =========================================
// AUTHORIZED TARGETS
// =========================================

app.post(
    "/api/targets/declare",
    requireAuth,
    async (req, res) => {

        const target = req.body.target;
        const statement = req.body.authorizationStatement;

        if (!target || typeof target !== "string" || target.trim().length === 0) {

            return res.status(400).json({ success: false, error: "target is required." });
        }

        if (!statement || typeof statement !== "string" || statement.trim().length < 10) {

            return res.status(400).json({
                success: false,
                error: "You must explicitly confirm you own or have written permission to test this target (authorizationStatement, min 10 characters)."
            });
        }

        const result = declareAuthorizedTarget(req.user.userId, target.trim(), statement.trim());

        res.json({
            success: true,
            targetId: result.id,
            isKnownLab: result.isKnownLab,
            expiresAt: result.expiresAt,
            message: result.isKnownLab
                ? "Recognized as a known CTF/lab platform. Authorized for 24 hours."
                : "Target declared and logged. Authorized for 24 hours based on your statement."
        });
    }
);

app.get(
    "/api/targets",
    requireAuth,
    async (req, res) => {

        const targets = getActiveAuthorizedTargets(req.user.userId);

        res.json({ success: true, targets: targets });
    }
);


// =========================================
// CONVERSATIONS (multiple chat threads)
// =========================================

app.post(
    "/api/conversations",
    requireAuth,
    async (req, res) => {

        const id = createConversation(req.user.userId, req.body.title);

        res.json({ success: true, conversationId: id });
    }
);

app.get(
    "/api/conversations",
    requireAuth,
    async (req, res) => {

        const conversations = listConversations(req.user.userId);

        res.json({ success: true, conversations: conversations });
    }
);

app.get(
    "/api/conversations/:id",
    requireAuth,
    async (req, res) => {

        const conversation = getConversation(req.user.userId, req.params.id);

        if (!conversation) {

            return res.status(404).json({ success: false, error: "Conversation not found." });
        }

        res.json({ success: true, conversation: conversation });
    }
);

app.delete(
    "/api/conversations/:id",
    requireAuth,
    async (req, res) => {

        const deleted = deleteConversation(req.user.userId, req.params.id);

        if (!deleted) {

            return res.status(404).json({ success: false, error: "Conversation not found." });
        }

        res.json({ success: true, message: "Conversation deleted." });
    }
);

app.patch(
    "/api/conversations/:id",
    requireAuth,
    async (req, res) => {

        const newTitle = req.body.title;

        if (!newTitle || typeof newTitle !== "string") {

            return res.status(400).json({ success: false, error: "title is required." });
        }

        const renamed = renameConversation(req.user.userId, req.params.id, newTitle.trim());

        if (!renamed) {

            return res.status(404).json({ success: false, error: "Conversation not found." });
        }

        res.json({ success: true, message: "Conversation renamed." });
    }
);


// =========================================
// CTF SESSIONS
// =========================================

app.post(
    "/api/ctf/sessions",
    requireAuth,
    async (req, res) => {

        const challengeName = req.body.challengeName;
        const category = req.body.category;
        const description = req.body.description;

        if (!challengeName || typeof challengeName !== "string" || challengeName.trim().length === 0) {

            return res.status(400).json({ success: false, error: "challengeName is required." });
        }

        const id = createCtfSession(
            req.user.userId,
            challengeName.trim(),
            category || null,
            description || null
        );

        res.json({ success: true, sessionId: id });
    }
);

app.get(
    "/api/ctf/sessions",
    requireAuth,
    async (req, res) => {

        const sessions = listCtfSessions(req.user.userId);

        res.json({ success: true, sessions: sessions });
    }
);

app.get(
    "/api/ctf/sessions/:id",
    requireAuth,
    async (req, res) => {

        const session = getCtfSession(req.user.userId, req.params.id);

        if (!session) {

            return res.status(404).json({ success: false, error: "Session not found." });
        }

        res.json({ success: true, session: session });
    }
);

app.delete(
    "/api/ctf/sessions/:id",
    requireAuth,
    async (req, res) => {

        const deleted = deleteCtfSession(req.user.userId, req.params.id);

        if (!deleted) {

            return res.status(404).json({ success: false, error: "Session not found." });
        }

        res.json({ success: true, message: "Session deleted." });
    }
);

app.post(
    "/api/ctf/sessions/:id/chat",
    requireAuth,
    apiLimiter,
    async (req, res) => {

        const userMessage = req.body.message;

        if (!userMessage || typeof userMessage !== "string" || userMessage.trim().length === 0) {

            return res.status(400).json({ success: false, error: "Message is required." });
        }

        if (userMessage.length > 8000) {

            return res.status(400).json({ success: false, error: "Message is too long. Please keep it under 8000 characters." });
        }

        const session = getCtfSession(req.user.userId, req.params.id);

        if (!session) {

            return res.status(404).json({ success: false, error: "Session not found." });
        }

        const activeTargets = getActiveAuthorizedTargets(req.user.userId);

        const targetContext =
            activeTargets.length > 0
                ? "AUTHORIZED TARGETS FOR THIS USER (confirmed, logged):\n" +
                  activeTargets.map(t => "- " + t.target + (t.isKnownLab ? " (known CTF/lab platform)" : " (user-declared, self-attested)")).join("\n")
                : "NO AUTHORIZED TARGETS DECLARED YET. If the user asks you to analyze or attack a specific live target (not a file/challenge artifact), tell them to declare it first via the authorization system before you give specific exploitation guidance against it.";

        const ctfHistory = session.chatHistory;

        ctfHistory.push({ role: "user", content: userMessage });

        const contextText =
            CTF_PERSONALITY +
            "\n\n" + targetContext +
            "\n\nCHALLENGE: " + session.challengeName +
            (session.category ? "\nCATEGORY: " + session.category : "") +
            (session.description ? "\nDESCRIPTION: " + session.description : "") +
            "\n\nKNOWN CLUES SO FAR:\n" + JSON.stringify(session.clues) +
            "\n\nFAILED APPROACHES (do not repeat these):\n" + JSON.stringify(session.failedApproaches);

        let answer;
        let provider;

        try {

            answer = await askGemini(
                [{ role: "user", content: contextText }].concat(ctfHistory),
                null
            );

            provider = "Gemini";

        } catch (geminiError) {

            try {

                answer = await askOpenRouter(
                    [{ role: "user", content: contextText }].concat(ctfHistory),
                    null
                );

                provider = "OpenRouter";

            } catch (openRouterError) {

                ctfHistory.pop();

                return res.status(500).json({ success: false, error: "Both AI providers are currently unavailable." });
            }
        }

        ctfHistory.push({ role: "assistant", content: answer });

        updateCtfSession(req.user.userId, req.params.id, { chatHistory: ctfHistory });

        res.json({ success: true, provider: provider, response: answer });
    }
);


// =========================================
// CTF FILE UPLOADS
// =========================================

app.post(
    "/api/ctf/sessions/:id/files",
    requireAuth,
    async (req, res) => {

        const session = getCtfSession(req.user.userId, req.params.id);

        if (!session) {

            return res.status(404).json({ success: false, error: "Session not found." });
        }

        const filename = req.body.filename;
        const mimeType = req.body.mimeType;
        const fileData = req.body.fileData;

        if (!filename || !fileData || typeof fileData !== "string") {

            return res.status(400).json({ success: false, error: "filename and fileData are required." });
        }

        let base64Only = fileData;

        if (fileData.startsWith("data:")) {

            const match = fileData.match(/^data:(.+?);base64,(.+)$/);

            if (match) {
                base64Only = match[2];
            }
        }

        try {

            const fileId = storeCtfFile(req.user.userId, req.params.id, filename, mimeType, base64Only);

            res.json({ success: true, fileId: fileId });

        } catch (error) {

            res.status(400).json({ success: false, error: error.message });
        }
    }
);

app.get(
    "/api/ctf/sessions/:id/files",
    requireAuth,
    async (req, res) => {

        const files = listCtfFiles(req.user.userId, req.params.id);

        res.json({ success: true, files: files });
    }
);


// =========================================
// CHAT API (regular, non-streaming)
// =========================================

app.post(
    "/api/chat",
    apiLimiter,
    requireAuth,
    async (req, res) => {

        const userId = req.user.userId;
        const userData = loadUserData(userId);

        let conversationHistory = userData.conversationHistory;
        let userProfile = userData.profile;

        const userMessage = req.body.message;

        if (!userMessage || typeof userMessage !== "string") {

            return res.status(400).json({ success: false, error: "Message is required" });
        }

        if (userMessage.length > 8000) {

            return res.status(400).json({ success: false, error: "Message is too long. Please keep it under 8000 characters." });
        }

        if (userMessage.trim().length === 0) {

            return res.status(400).json({ success: false, error: "Message cannot be empty." });
        }

        logInfo("User: " + userMessage);

        const lowerMessage = userMessage.toLowerCase().trim();

        if (lowerMessage === "what do you remember about me") {

            const memoryKeys = Object.keys(userProfile);

            if (memoryKeys.length === 0) {

                return res.json({ success: true, provider: "Memory", response: "I don't have any saved information about you yet." });
            }

            let memoryText = "Here is what I remember about you:\n\n";

            if (userProfile.name) {
                memoryText += "👤 Name: " + userProfile.name + "\n";
            }

            if (userProfile.interests) {

                const interests = Array.isArray(userProfile.interests) ? userProfile.interests.join(", ") : userProfile.interests;

                memoryText += "🎯 Interests: " + interests + "\n";
            }

            if (userProfile.favorite_language) {
                memoryText += "💻 Favorite programming language: " + userProfile.favorite_language + "\n";
            }

            if (userProfile.project) {
                memoryText += "🚀 Project: " + userProfile.project + "\n";
            }

            return res.json({ success: true, provider: "Memory", response: memoryText.trim() });
        }

        if (lowerMessage === "forget everything you remember about me") {

            userProfile = {};
            userData.profile = userProfile;
            saveUserData(userId, userData);

            return res.json({ success: true, provider: "Memory", response: "Done. I cleared my saved personal memory." });
        }

        conversationHistory.push({ role: "user", content: userMessage });
        updateProfileFromMessage(userMessage, userProfile);

        let answer;
        let provider;

        try {

            logInfo("Trying Gemini...");

            answer = await askGemini(conversationHistory, userProfile);
            provider = "Gemini";

            logInfo("Gemini response received.");

        } catch (geminiError) {

            logWarn("Gemini failed: " + geminiError.message);
            logInfo("Trying OpenRouter fallback...");

            try {

                answer = await askOpenRouter(conversationHistory, userProfile);
                provider = "OpenRouter";

                logInfo("OpenRouter response received.");

            } catch (openRouterError) {

                logWarn("OpenRouter failed: " + openRouterError.message);

                conversationHistory.pop();

                return res.status(500).json({ success: false, error: "Both AI providers are currently unavailable." });
            }
        }

        conversationHistory.push({ role: "assistant", content: answer });

        userData.conversationHistory = conversationHistory;
        userData.profile = userProfile;

        saveUserData(userId, userData);

        res.json({ success: true, provider: provider, response: answer });
    }
);


// =========================================
// STREAMING CHAT API
// =========================================

app.post(
    "/api/chat/stream",
    apiLimiter,
    requireAuth,
    async (req, res) => {

        const userMessage = req.body.message;

        if (!userMessage || typeof userMessage !== "string" || userMessage.trim().length === 0) {

            return res.status(400).json({ success: false, error: "Message cannot be empty." });
        }

        if (userMessage.length > 8000) {

            return res.status(400).json({ success: false, error: "Message is too long." });
        }

        const userId = req.user.userId;
        const userData = loadUserData(userId);

        let conversationHistory = userData.conversationHistory;
        let userProfile = userData.profile;

        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders();

        conversationHistory.push({ role: "user", content: userMessage });
        updateProfileFromMessage(userMessage, userProfile);

        try {

            let answer;
            let provider;

            try {

                answer = await askGeminiStream(conversationHistory, userProfile, res);
                provider = "Gemini";

            } catch (geminiError) {

                logWarn("Gemini stream failed, falling back to OpenRouter", geminiError);

                answer = await askOpenRouter(conversationHistory, userProfile);
                provider = "OpenRouter";

                res.write("data: " + JSON.stringify({ chunk: answer }) + "\n\n");
            }

            conversationHistory.push({ role: "assistant", content: answer });

            userData.conversationHistory = conversationHistory;
            userData.profile = userProfile;

            saveUserData(userId, userData);

            res.write("data: " + JSON.stringify({ done: true, provider: provider }) + "\n\n");
            res.end();

        } catch (error) {

            logError("Streaming chat failed", error);

            conversationHistory.pop();

            res.write("data: " + JSON.stringify({ error: "Both AI providers are currently unavailable." }) + "\n\n");
            res.end();
        }
    }
);


// =========================================
// MEMORY MANAGEMENT API
// =========================================

app.get("/api/memory", requireAuth, async (req, res) => {

    const userData = loadUserData(req.user.userId);

    res.json({ success: true, memory: userData.profile });
});

app.post("/api/memory", requireAuth, async (req, res) => {

    const key = req.body.key;
    const value = req.body.value;

    if (!key || value === undefined) {

        return res.status(400).json({ success: false, error: "key and value are required" });
    }

    const userData = loadUserData(req.user.userId);

    userData.profile[key] = value;

    saveUserData(req.user.userId, userData);

    res.json({ success: true, message: "Memory saved.", memory: userData.profile });
});

app.delete("/api/memory", requireAuth, async (req, res) => {

    const userData = loadUserData(req.user.userId);

    userData.profile = {};

    saveUserData(req.user.userId, userData);

    res.json({ success: true, message: "NANI AI memory cleared." });
});


// =========================================
// 404 HANDLER
// =========================================

app.use(function (req, res) {

    res.status(404).json({ success: false, error: "Route not found." });
});


// =========================================
// GLOBAL ERROR HANDLER
// =========================================

app.use(function (err, req, res, next) {

    logError("Unhandled error on " + req.method + " " + req.originalUrl, err);

    if (err.message === "Not allowed by CORS") {

        return res.status(403).json({ success: false, error: "Origin not allowed." });
    }

    const response = { success: false, error: "An unexpected error occurred." };

    if (NODE_ENV === "development") {
        response.debug = err.message;
    }

    res.status(500).json(response);
});


// =========================================
// START SERVER
// =========================================

app.listen(PORT, "0.0.0.0", function () {

    console.log("NANI AI backend running on http://127.0.0.1:" + PORT + " [" + NODE_ENV + "]");
});
