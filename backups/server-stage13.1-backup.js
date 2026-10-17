require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const helmet = require("helmet");

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
const PORT = 3000;
const MEMORY_FILE = "./memory.json";
const PROFILE_FILE = "./profile.json";
const USERS_FILE = "./users.json";

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

function loadUsers() {

    try {

        if (!fs.existsSync(USERS_FILE)) {
            fs.writeFileSync(USERS_FILE, "[]");
        }

        const data =
            fs.readFileSync(
                USERS_FILE,
                "utf8"
            );

        return JSON.parse(data || "[]");

    } catch (error) {

        console.log(
            "Users load error:",
            error.message
        );

        return [];
    }
}


function saveUsers(users) {

    fs.writeFileSync(
        USERS_FILE,
        JSON.stringify(
            users,
            null,
            2
        )
    );
}


let users = loadUsers();
// =========================================
// UPDATE LONG-TERM MEMORY
// =========================================

function updateProfileFromMessage(userMessage) {

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


    // Save only when something changed
    saveProfile(userProfile);
}
// =========================================
// TEST
// =========================================

app.get("/", (req, res) => {

    res.json({

        success: true,

        message:
            "NANI AI backend is working!"

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
// CHAT API
// =========================================
app.post(
    "/api/chat",
    async (req, res) => {

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

    saveProfile(userProfile);

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
updateProfileFromMessage(userMessage);

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


        saveMemory(
            conversationHistory
        );


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
app.get("/api/memory", (req, res) => {

    res.json({
        success: true,
        memory: userProfile
    });

});


// SAVE MEMORY MANUALLY
app.post("/api/memory", (req, res) => {

    const key = req.body.key;
    const value = req.body.value;

    if (!key || value === undefined) {

        return res.status(400).json({
            success: false,
            error: "key and value are required"
        });

    }

    userProfile[key] = value;

    saveProfile(userProfile);

    res.json({
        success: true,
        message: "Memory saved.",
        memory: userProfile
    });

});


// CLEAR MEMORY
app.delete("/api/memory", (req, res) => {

    userProfile = {};

    saveProfile(userProfile);

    res.json({
        success: true,
        message: "NANI AI memory cleared."
    });

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
            PORT
        );

        console.log(
            "Memory loaded:",
            conversationHistory.length,
            "messages"
        );

    }
);
