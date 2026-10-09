require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = 3000;

const MEMORY_FILE = "./memory.json";

app.use(cors());
app.use(express.json());


// =========================================
// MEMORY FUNCTIONS
// =========================================

function loadMemory() {
    try {
        if (!fs.existsSync(MEMORY_FILE)) {
            fs.writeFileSync(MEMORY_FILE, "[]");
        }

        const data = fs.readFileSync(MEMORY_FILE, "utf8");

        return JSON.parse(data || "[]");

    } catch (error) {
        console.log("Memory load error:", error.message);
        return [];
    }
}


function saveMemory(memory) {
    fs.writeFileSync(
        MEMORY_FILE,
        JSON.stringify(memory, null, 2)
    );
}


let conversationHistory = loadMemory();


// =========================================
// TEST
// =========================================

app.get("/", (req, res) => {
    res.json({
        success: true,
        message: "NANI AI backend is working!"
    });
});


// =========================================
// GEMINI
// =========================================

async function askGemini(history) {

    const url =
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent?key=" +
        process.env.GEMINI_API_KEY;

    const response = await fetch(url, {
        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify({
            contents: history.map((message) => ({
                role:
                    message.role === "assistant"
                        ? "model"
                        : "user",

                parts: [
                    {
                        text: message.content
                    }
                ]
            }))
        })
    });

    if (!response.ok) {
        throw new Error(
            "Gemini failed: " + response.status
        );
    }

    const data = await response.json();

    if (
        !data.candidates ||
        !data.candidates[0] ||
        !data.candidates[0].content
    ) {
        throw new Error(
            "Gemini returned an invalid response"
        );
    }

    return data.candidates[0]
        .content
        .parts[0]
        .text;
}


// =========================================
// OPENROUTER FALLBACK
// =========================================

async function askOpenRouter(history) {

    const response = await fetch(
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
                model: "openrouter/free",
                messages: history
            })
        }
    );

    if (!response.ok) {
        throw new Error(
            "OpenRouter failed: " +
            response.status
        );
    }

    const data = await response.json();

    if (
        !data.choices ||
        !data.choices[0] ||
        !data.choices[0].message
    ) {
        throw new Error(
            "OpenRouter returned an invalid response"
        );
    }

    return data.choices[0]
        .message
        .content;
}


// =========================================
// CHAT API
// =========================================

app.post("/api/chat", async (req, res) => {

    const userMessage = req.body.message;

    if (
        !userMessage ||
        typeof userMessage !== "string"
    ) {
        return res.status(400).json({
            success: false,
            error: "Message is required"
        });
    }

    console.log("User:", userMessage);


    // Add user message
    conversationHistory.push({
        role: "user",
        content: userMessage
    });


    let answer;
    let provider;


    // =====================================
    // GEMINI FIRST
    // =====================================

    try {

        console.log("Trying Gemini...");

        answer =
            await askGemini(
                conversationHistory
            );

        provider = "Gemini";

        console.log(
            "Gemini response received."
        );

    } catch (geminiError) {

        console.log(
            "Gemini failed:",
            geminiError.message
        );

        console.log(
            "Trying OpenRouter..."
        );


        // =================================
        // OPENROUTER
        // =================================

        try {

            answer =
                await askOpenRouter(
                    conversationHistory
                );

            provider = "OpenRouter";

            console.log(
                "OpenRouter response received."
            );

        } catch (openRouterError) {

            console.log(
                "OpenRouter failed:",
                openRouterError.message
            );

            // Remove failed user message
            conversationHistory.pop();

            return res.status(500).json({
                success: false,
                error:
                    "Both AI providers are unavailable."
            });
        }
    }


    // =====================================
    // SAVE AI RESPONSE TO MEMORY
    // =====================================

    conversationHistory.push({
        role: "assistant",
        content: answer
    });


    // Save permanently
    saveMemory(conversationHistory);


    // =====================================
    // RESPONSE
    // =====================================

    res.json({
        success: true,
        provider: provider,
        response: answer
    });

});


// =========================================
// START SERVER
// =========================================

app.listen(
    PORT,
    "0.0.0.0",
    function() {

        console.log(
            "NANI AI backend running on http://127.0.0.1:" +
            PORT
        );

        console.log(
            "Permanent memory loaded:",
            conversationHistory.length,
            "messages"
        );
    }
);
