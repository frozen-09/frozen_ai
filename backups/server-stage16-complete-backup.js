require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { DatabaseSync } = require("node:sqlite");



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


const REQUIRED_ENV_VARS = [
    "GEMINI_API_KEY",
    "OPENROUTER_API_KEY",
    "JWT_SECRET"
];

const missingVars =
    REQUIRED_ENV_VARS.filter(
        function (key) {
            return !process.env[key] || process.env[key].trim() === "";
        }
    );

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

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";
const MEMORY_FILE = "./memory.json";
const PROFILE_FILE = "./profile.json";
const USERS_FILE = "./users.json";
const USER_DATA_DIR = "./user-data";


const DB_FILE = "./nani.db";

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

console.log("Database ready:", DB_FILE);


// =========================================
// NANI AI PERSONALITY
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


// =========================================
// MIDDLEWARE
// =========================================
const allowedOrigins = [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://localhost:8158",
    "http://127.0.0.1:8158"
];

app.use(helmet());


const authLimiter = rateLimit({

    windowMs: 15 * 60 * 1000,

    max: 10,

    message: {

        success: false,

        error: "Too many attempts. Please try again in 15 minutes."

    },

    standardHeaders: true,

    legacyHeaders: false

});


const apiLimiter = rateLimit({

    windowMs: 60 * 1000,

    max: 30,

    message: {

        success: false,

        error: "Too many requests. Please slow down."

    },

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
// MEMORY
// =========================================

function loadMemory() {

    try {

        if (!fs.existsSync(MEMORY_FILE)) {
            fs.writeFileSync(MEMORY_FILE, "[]");
        }

        const data =
            fs.readFileSync(
                MEMORY_FILE,
                "utf8"
            );

        return JSON.parse(data || "[]");

    } catch (error) {

        console.log(
            "Memory load error:",
            error.message
        );

        return [];

    }
}


function saveMemory(memory) {

    fs.writeFileSync(
        MEMORY_FILE,
        JSON.stringify(
            memory,
            null,
            2
        )
    );

}


let conversationHistory = loadMemory();
// =========================================
// LONG-TERM PROFILE MEMORY
// =========================================

function loadProfile() {

    try {

        if (!fs.existsSync(PROFILE_FILE)) {
            fs.writeFileSync(
                PROFILE_FILE,
                "{}"
            );
        }

        const data =
            fs.readFileSync(
                PROFILE_FILE,
                "utf8"
            );

        return JSON.parse(
            data || "{}"
        );

    } catch (error) {

        console.log(
            "Profile load error:",
            error.message
        );

        return {};
    }
}


function saveProfile(profile) {

    fs.writeFileSync(
        PROFILE_FILE,
        JSON.stringify(
            profile,
            null,
            2
        )
    );
}


let userProfile = loadProfile();

function findUserByUsername(username) {

    const row =
        db.prepare("SELECT * FROM users WHERE username = ?")
            .get(username);

    return row || null;
}


function createUser(id, username, passwordHash, createdAt) {

    db.prepare(
        "INSERT INTO users (id, username, passwordHash, createdAt) VALUES (?, ?, ?, ?)"
    ).run(id, username, passwordHash, createdAt);
}
function loadUserData(userId) {

    const row =
        db.prepare("SELECT * FROM user_data WHERE userId = ?")
            .get(userId);


    if (!row) {

        return {

            conversationHistory: [],

            profile: {}

        };
    }


    return {

        conversationHistory:
            JSON.parse(row.conversationHistory),

        profile:
            JSON.parse(row.profile)

    };
}


function saveUserData(userId, userData) {

    const conversationJson =
        JSON.stringify(userData.conversationHistory);

    const profileJson =
        JSON.stringify(userData.profile);


    db.prepare(`
        INSERT INTO user_data (userId, conversationHistory, profile)
        VALUES (?, ?, ?)
        ON CONFLICT(userId) DO UPDATE SET
            conversationHistory = excluded.conversationHistory,
            profile = excluded.profile
    `).run(userId, conversationJson, profileJson);
}


// =========================================
// UPDATE LONG-TERM MEMORY
// =========================================

function updateProfileFromMessage(userMessage,userProfile) {

    const text = userMessage.trim();

    // Remember user's name
    const nameMatch =
        text.match(
            /(?:my name is|i am|i'm)\s+([a-zA-Z][a-zA-Z ]{1,30})/i
        );

    if (nameMatch) {

        userProfile.name =
            nameMatch[1].trim();

        console.log(
            "Memory updated: name =",
            userProfile.name
        );
    }


    // Remember interests
    const interestMatch =
        text.match(
            /(?:i like|i love|i am interested in|my interest is)\s+(.+)/i
        );

    if (interestMatch) {

        const interest =
            interestMatch[1].trim();

        if (!userProfile.interests) {
            userProfile.interests = [];
        }

        if (
            !userProfile.interests
                .includes(interest)
        ) {

            userProfile.interests.push(
                interest
            );

            console.log(
                "Memory updated: interest =",
                interest
            );
        }
    }


    // Remember favorite programming language
    const languageMatch =
        text.match(
            /(?:my favorite programming language is|my favourite programming language is)\s+([a-zA-Z0-9+#]+)/i
        );

    if (languageMatch) {

        userProfile.favorite_language =
            languageMatch[1].trim();

        console.log(
            "Memory updated: favorite language =",
            userProfile.favorite_language
        );
    }


    // Save only when something changed (caller handles persistence)
}
// =========================================
// TEST
// =========================================


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
// GEMINI
// =========================================

async function askGemini(history) {

    const url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY;


    const geminiHistory = history.map(
        (message) => ({

            role:
                message.role === "assistant"
                    ? "model"
                    : "user",

            parts: [
                {
                    text: message.content
                }
            ]

        })
    );


    const profileText =
    JSON.stringify(
        userProfile,
        null,
        2
    );

const contents = [

    {
        role: "user",

        parts: [
            {
                text:
                    NANI_PERSONALITY +
                    "\n\nLONG-TERM USER MEMORY:\n" +
                    profileText +
                    "\n\nUse this memory when relevant. " +
                    "Do not reveal private credentials."
            }
        ]
    },

    ...geminiHistory

];

    const response =
        await fetch(
            url,
            {

                method: "POST",

                headers: {

                    "Content-Type":
                        "application/json"

                },

                body: JSON.stringify({

                    contents: contents

                })

            }
        );


   if (!response.ok) {

    let errorMessage =
        "Gemini request failed";

    try {

        const errorData =
            await response.json();

        if (
            errorData.error &&
            errorData.error.message
        ) {

            errorMessage =
                errorData.error.message;

        }

    } catch (parseError) {

        errorMessage =
            "Gemini HTTP " +
            response.status;

    }

    throw new Error(
        "Gemini failed: " +
        response.status +
        " - " +
        errorMessage
    );

}

    const data =
        await response.json();


    if (
        !data.candidates ||
        !data.candidates[0] ||
        !data.candidates[0].content
    ) {

        throw new Error(
            "Gemini returned an invalid response"
        );

    }


    return data
        .candidates[0]
        .content
        .parts[0]
        .text;

}


// =========================================
// OPENROUTER FALLBACK
// =========================================

async function askOpenRouter(history) {

    const profileText =
    JSON.stringify(
        userProfile,
        null,
        2
    );

const messages = [

    {
        role: "system",

        content:
            NANI_PERSONALITY +
            "\n\nLONG-TERM USER MEMORY:\n" +
            profileText +
            "\n\nUse this memory when relevant. " +
            "Do not reveal private credentials."

    },

    ...history

];

    const response =
        await fetch(
            "https://openrouter.ai/api/v1/chat/completions",
            {

                method: "POST",

                headers: {

                    "Authorization":
                        "Bearer " +
                        process.env.OPENROUTER_API_KEY,

                    "Content-Type":
                        "application/json"

                },

                body: JSON.stringify({

                    model:
                        "openrouter/free",

                    messages:
                        messages

                })

            }
        );


    if (!response.ok) {

    let errorMessage =
        "OpenRouter request failed";

    try {

        const errorData =
            await response.json();

        if (
            errorData.error &&
            errorData.error.message
        ) {

            errorMessage =
                errorData.error.message;

        }

    } catch (parseError) {

        errorMessage =
            "OpenRouter HTTP " +
            response.status;

    }

    throw new Error(
        "OpenRouter failed: " +
        response.status +
        " - " +
        errorMessage
    );

}


    const data =
        await response.json();


    if (
        !data.choices ||
        !data.choices[0] ||
        !data.choices[0].message
    ) {

        throw new Error(
            "OpenRouter returned an invalid response"
        );

    }


    return data
        .choices[0]
        .message
        .content;

}
// =========================================
// IMAGE AI
// =========================================

async function askGeminiImage(message, imageData) {

    const url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY;

    const parts = [];

    parts.push({
        text:
            NANI_PERSONALITY +
            "\n\nUser question:\n" +
            message
    });

    parts.push({
        inline_data: {
            mime_type: imageData.mimeType,
            data: imageData.base64
        }
    });

    const response = await fetch(
        url,
        {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({
                contents: [
                    {
                        role: "user",
                        parts: parts
                    }
                ]
            })
        }
    );

    if (!response.ok) {

        throw new Error(
            "Gemini image failed: " +
            response.status
        );
    }

    const data =
        await response.json();

    if (
        !data.candidates ||
        !data.candidates[0] ||
        !data.candidates[0].content
    ) {

        throw new Error(
            "Gemini image returned invalid response"
        );
    }

    return data
        .candidates[0]
        .content
        .parts[0]
        .text;
}


// =========================================
// IMAGE API
// =========================================

app.post(
    "/api/image",
requireAuth,    
async (req, res) => {

       

        const message =
            req.body.message ||
            "Describe this image.";

        const image =
            req.body.image;

        if (!image || typeof image !== "string") {

            return res.status(400).json({

                success: false,

                error:
                    "Image is required"

            });
        }


        const ALLOWED_IMAGE_TYPES = [
            "image/jpeg",
            "image/png",
            "image/webp"
        ];


        const mimeMatch =
            image.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,/);


        if (!mimeMatch) {

            return res.status(400).json({

                success: false,

                error:
                    "Invalid image format."

            });
        }


        if (!ALLOWED_IMAGE_TYPES.includes(mimeMatch[1])) {

            return res.status(400).json({

                success: false,

                error:
                    "Unsupported image type. Use JPEG, PNG, or WEBP."

            });
        }


        const approxSizeBytes =
            (image.length * 3) / 4;


        if (approxSizeBytes > 8 * 1024 * 1024) {

            return res.status(400).json({

                success: false,

                error:
                    "Image is too large. Maximum size is 8MB."

            });
        }
console.log(
            "Image request received."
        );

        try {

            let base64Data = image;
            let mimeType = "image/jpeg";

            if (
                image.startsWith(
                    "data:"
                )
            ) {

                const match =
                    image.match(
                        /^data:(.+?);base64,(.+)$/
                    );

                if (!match) {

                    throw new Error(
                        "Invalid image format"
                    );
                }

                mimeType =
                    match[1];

                base64Data =
                    match[2];
            }

            const answer =
                await askGeminiImage(
                    message,
                    {
                        mimeType:
                            mimeType,

                        base64:
                            base64Data
                    }
                );

            console.log(
                "Image response received."
            );

            res.json({

                success: true,

                provider:
                    "Gemini",

                response:
                    answer

            });

        } catch (error) {

            console.log(
                "Image AI failed:",
                error.message
            );

            res.status(500).json({

                success: false,

                error:
                    "NANI AI could not analyze the image."

            });
        }
    }
);


// =========================================
// AUTH MIDDLEWARE
// =========================================

function requireAuth(req, res, next) {

    const authHeader =
        req.headers.authorization;


    if (!authHeader || !authHeader.startsWith("Bearer ")) {

        return res.status(401).json({

            success: false,

            error:
                "Authentication required."

        });
    }


    const token =
        authHeader.split(" ")[1];


    try {

        const decoded =
            jwt.verify(token, process.env.JWT_SECRET);


        req.user = decoded;

        next();


    } catch (error) {

        return res.status(401).json({

            success: false,

            error:
                "Invalid or expired token."

        });
    }
}





// =========================================
// AUTH: SIGNUP
// =========================================


app.post(
    "/api/signup",
    authLimiter,
    async (req, res) => {

        const username =
            req.body.username;

        const password =
            req.body.password;


        if (
            !username ||
            typeof username !== "string" ||
            username.trim().length < 3
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "Username must be at least 3 characters."

            });
        }


        if (
            !password ||
            typeof password !== "string" ||
            password.length < 6
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "Password must be at least 6 characters."

            });
        }


        const cleanUsername =
            username.trim().toLowerCase();


        const existingUser =
            findUserByUsername(cleanUsername);


        if (existingUser) {

            return res.status(409).json({

                success: false,

                error:
                    "Username already exists."

            });
        }


        try {

            const passwordHash =
                await bcrypt.hash(password, 10);


            const newUserId =
                Date.now().toString();


            createUser(
                newUserId,
                cleanUsername,
                passwordHash,
                new Date().toISOString()
            );


            console.log(
                "New user created:",
                cleanUsername
            );

            res.json({

                success: true,

                message:
                    "Account created successfully. Please log in."

            });


        } catch (error) {

            console.log(
                "Signup error:",
                error.message
            );


            res.status(500).json({

                success: false,

                error:
                    "Could not create account."

            });
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

        const username =
            req.body.username;

        const password =
            req.body.password;


        if (
            !username ||
            !password ||
            typeof username !== "string" ||
            typeof password !== "string"
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "Username and password are required."

            });
        }


        const cleanUsername =
            username.trim().toLowerCase();


        const user =
            findUserByUsername(cleanUsername);

        if (!user) {

            return res.status(401).json({

                success: false,

                error:
                    "Invalid username or password."

            });
        }


        try {

            const passwordMatches =
                await bcrypt.compare(
                    password,
                    user.passwordHash
                );


            if (!passwordMatches) {

                return res.status(401).json({

                    success: false,

                    error:
                        "Invalid username or password."

                });
            }


            const token =
                jwt.sign(
                    {
                        userId: user.id,
                        username: user.username
                    },
                    process.env.JWT_SECRET,
                    {
                        expiresIn: "7d"
                    }
                );


            console.log(
                "User logged in:",
                user.username
            );


            res.json({

                success: true,

                token:
                    token,

                username:
                    user.username

            });


        } catch (error) {

            console.log(
                "Login error:",
                error.message
            );


            res.status(500).json({

                success: false,

                error:
                    "Login failed."

            });
        }
    }
);


// =========================================
// AUTH TEST ROUTE (temporary, for Stage 13.4 verification)
// =========================================

app.get(
    "/api/protected-test",
    requireAuth,
    (req, res) => {

        res.json({

            success: true,

            message:
                "You are authenticated.",

            user:
                req.user

        });
    }
);



// =========================================
// CHAT API
// =========================================
app.post(
    "/api/chat",
    apiLimiter,
    requireAuth,
    async (req, res) => {

        const userId =
            req.user.userId;

        const userData =
            loadUserData(userId);

        let conversationHistory =
            userData.conversationHistory;

        let userProfile =
            userData.profile;

        const userMessage =
            req.body.message;
        if (
            !userMessage ||
            typeof userMessage !==
                "string"
        ) {

            return res.status(400).json({

                success: false,

                error:
                    "Message is required"

            });

        }


        if (userMessage.length > 8000) {

            return res.status(400).json({

                success: false,

                error:
                    "Message is too long. Please keep it under 8000 characters."

            });

        }


        if (userMessage.trim().length === 0) {

            return res.status(400).json({

                success: false,

                error:
                    "Message cannot be empty."

            });

        }

        console.log(
    "User:",
    userMessage
);

// =========================================
// MEMORY COMMANDS
// =========================================

const lowerMessage =
    userMessage.toLowerCase().trim();


// SHOW MEMORY
// SHOW MEMORY
if (
    lowerMessage ===
    "what do you remember about me"
) {

    const memoryKeys =
        Object.keys(userProfile);

    if (memoryKeys.length === 0) {

        return res.json({

            success: true,

            provider: "Memory",

            response:
                "I don't have any saved information about you yet."

        });

    }

    let memoryText =
        "Here is what I remember about you:\n\n";


    if (userProfile.name) {

        memoryText +=
            "👤 Name: " +
            userProfile.name +
            "\n";

    }


    if (userProfile.interests) {

        const interests =
            Array.isArray(userProfile.interests)
                ? userProfile.interests.join(", ")
                : userProfile.interests;

        memoryText +=
            "🎯 Interests: " +
            interests +
            "\n";

    }


    if (userProfile.favorite_language) {

        memoryText +=
            "💻 Favorite programming language: " +
            userProfile.favorite_language +
            "\n";

    }


    if (userProfile.project) {

        memoryText +=
            "🚀 Project: " +
            userProfile.project +
            "\n";

    }


    return res.json({

        success: true,

        provider: "Memory",

        response: memoryText.trim()

    });

}

// FORGET ALL MEMORY
if (
    lowerMessage ===
    "forget everything you remember about me"
) {

    userProfile = {};

    userData.profile = userProfile;

    saveUserData(userId, userData);
    return res.json({

        success: true,

        provider: "Memory",

        response:
            "Done. I cleared my saved personal memory."

    });

}
        conversationHistory.push({

            role: "user",

            content:
                userMessage

        });
updateProfileFromMessage(userMessage,userProfile);

        let answer;

        let provider;


        // =================================
        // GEMINI FIRST
        // =================================

        try {

            console.log(
                "Trying Gemini..."
            );


            answer =
                await askGemini(
                    conversationHistory
                );


            provider =
                "Gemini";


            console.log(
                "Gemini response received."
            );

        }


        catch (geminiError) {

            console.log(
                "Gemini failed:",
                geminiError.message
            );


            console.log(
                "Trying OpenRouter fallback..."
            );


            // =============================
            // OPENROUTER
            // =============================

            try {

                answer =
                    await askOpenRouter(
                        conversationHistory
                    );


                provider =
                    "OpenRouter";


                console.log(
                    "OpenRouter response received."
                );

            }


            catch (openRouterError) {

                console.log(
                    "OpenRouter failed:",
                    openRouterError.message
                );


                conversationHistory.pop();


                return res.status(500).json({

                    success: false,

                    error:
                        "Both AI providers are currently unavailable."

                });

            }

        }


        // =================================
        // SAVE CONVERSATION
        // =================================

        conversationHistory.push({

            role: "assistant",

            content:
                answer

        });


        userData.conversationHistory =
            conversationHistory;

        userData.profile =
            userProfile;

        saveUserData(userId, userData);

        // =================================
        // RESPONSE
        // =================================

        res.json({

            success: true,

            provider:
                provider,

            response:
                answer

        });

    }
);

// =========================================
// MEMORY MANAGEMENT API
// =========================================

// VIEW MEMORY
app.get("/api/memory", requireAuth, (req, res) => {

    const userData =
        loadUserData(req.user.userId);

    res.json({
        success: true,
        memory: userData.profile
    });

});

//=============================================
// SAVE MEMORY MANUALLY
//============================================
app.post("/api/memory", requireAuth, (req, res) => {

    const key = req.body.key;
    const value = req.body.value;

    if (!key || value === undefined) {

        return res.status(400).json({
            success: false,
            error: "key and value are required"
        });

    }

    const userData =
        loadUserData(req.user.userId);

    userData.profile[key] = value;

    saveUserData(req.user.userId, userData);

    res.json({
        success: true,
        message: "Memory saved.",
        memory: userData.profile
    });

});

// CLEAR MEMORY
app.delete("/api/memory", requireAuth, (req, res) => {

    const userData =
        loadUserData(req.user.userId);

    userData.profile = {};

    saveUserData(req.user.userId, userData);

    res.json({
        success: true,
        message: "NANI AI memory cleared."
    });

});    


// =========================================
// 404 HANDLER (no matching route)
// =========================================

app.use(function (req, res) {

    res.status(404).json({

        success: false,

        error: "Route not found."

    });
});


// =========================================
// GLOBAL ERROR HANDLER
// =========================================

app.use(function (err, req, res, next) {

    logError("Unhandled error on " + req.method + " " + req.originalUrl, err);


    if (err.message === "Not allowed by CORS") {

        return res.status(403).json({

            success: false,

            error: "Origin not allowed."

        });
    }


    const response = {

        success: false,

        error: "An unexpected error occurred."

    };


    if (NODE_ENV === "development") {

        response.debug = err.message;
    }


    res.status(500).json(response);
});

// =========================================
// START SERVER
// =========================================

app.listen(
    PORT,
    "0.0.0.0",
    function () {

                console.log(
            "NANI AI backend running on http://127.0.0.1:" +
            PORT +
            " [" + NODE_ENV + "]"
        );

        console.log(
            "Memory loaded:",
            conversationHistory.length,
            "messages"
        );

    }
);
