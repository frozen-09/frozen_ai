/* =========================================
NANI AI
STAGE 8A - IMAGE INPUT
========================================= */

const BACKEND_URL = "https://frozen-ai.onrender.com";
let authToken = null;
let isSignupMode = false;
/* =========================================
ELEMENTS
========================================= */
const authScreen = document.getElementById("authScreen");
const authTitle = document.getElementById("authTitle");
const authUsername = document.getElementById("authUsername");
const authPassword = document.getElementById("authPassword");
const authSubmitBtn = document.getElementById("authSubmitBtn");
const authError = document.getElementById("authError");
const authToggleText = document.getElementById("authToggleText");
const authToggleLink = document.getElementById("authToggleLink");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const chatArea = document.getElementById("chatArea");
const newChatBtn = document.getElementById("newChatBtn");
const welcomeScreen = document.getElementById("welcomeScreen");
const quickButtons = document.querySelectorAll(".quick-btn");
const micBtn = document.getElementById("micBtn");



/* =========================================
VOICE INPUT
========================================= */

(function() {

    const SpeechRecognition =
        window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {

        if (micBtn) {
            micBtn.addEventListener("click", function() {
                createMessage("Voice input isn't supported in this browser.", "ai");
            });
        }
        return;
    }

    const recognition = new SpeechRecognition();

    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "en-US";

    let isListening = false;

    if (micBtn) {

        micBtn.addEventListener("click", function() {

            if (isListening) {
                recognition.stop();
                return;
            }

            try {
                recognition.start();
            } catch (e) {
                /* prevents InvalidStateError on double-tap */
            }
        });
    }

    recognition.onstart = function() {
        isListening = true;
        if (micBtn) micBtn.classList.add("active");   // ← turns orb red + pulse
    };

    recognition.onend = function() {
        isListening = false;
        if (micBtn) micBtn.classList.remove("active"); // ← restores orb
    };

    recognition.onresult = function(event) {
        messageInput.value = event.results[0][0].transcript;
        messageInput.focus();
    };

    recognition.onerror = function(event) {
        isListening = false;
        if (micBtn) micBtn.classList.remove("active");

        if (event.error !== "aborted") {   // don't scare user when they tap stop
            createMessage("Voice input error: " + event.error, "ai");
        }
    };

})();
/* =========================================
AUTH
========================================= */

authToggleLink.addEventListener("click", function(event) {

    event.preventDefault();

    isSignupMode = !isSignupMode;

    authTitle.textContent = isSignupMode ? "Sign up for NANI AI" : "Login to NANI AI";

    authSubmitBtn.textContent = isSignupMode ? "Sign Up" : "Login";

    authToggleText.textContent = isSignupMode ? "Already have an account?" : "Don't have an account?";

    authToggleLink.textContent = isSignupMode ? "Login" : "Sign up";

    authError.textContent = "";
});


authSubmitBtn.addEventListener("click", async function() {

    const username = authUsername.value.trim();
    const password = authPassword.value;

    authError.textContent = "";

    if (!username || !password) {

        authError.textContent = "Please enter username and password.";

        return;
    }

    const endpoint = isSignupMode ? "/api/signup" : "/api/login";

    try {

        const response = await fetch(BACKEND_URL + endpoint, {

            method: "POST",

            headers: { "Content-Type": "application/json" },

            body: JSON.stringify({ username: username, password: password })
        });

        const data = await response.json();

        if (!data.success) {

            authError.textContent = data.error || "Something went wrong.";

            return;
        }

        if (isSignupMode) {

            authError.textContent = "Account created! Please log in.";

            isSignupMode = false;

            authTitle.textContent = "Login to NANI AI";

            authSubmitBtn.textContent = "Login";

            authToggleText.textContent = "Don't have an account?";

            authToggleLink.textContent = "Sign up";

            authPassword.value = "";

            return;
        }

        authToken = data.token;

        localStorage.setItem("nani_token", authToken);

        localStorage.setItem("nani_username", data.username);

        authScreen.style.display = "none";

    } catch (error) {

        authError.textContent = "Could not connect to server.";
    }
});


function checkExistingLogin() {

    const savedToken = localStorage.getItem("nani_token");
    if (savedToken) {

        authToken = savedToken;

        authScreen.style.display = "none";

    } else {

        authScreen.style.display = "flex";
    }
}

checkExistingLogin();
/* =========================================
IMAGE INPUT
========================================= */

const imageInput = document.createElement("input");

imageInput.type = "file";
imageInput.accept = "image/*";
imageInput.style.display = "none";

document.body.appendChild(imageInput);

/* =========================================
IMAGE BUTTON
========================================= */

const imageBtn = document.createElement("button");

imageBtn.type = "button";
imageBtn.className = "orb-btn img-btn";
imageBtn.title = "Analyze an image";
imageBtn.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none"
         stroke="currentColor" stroke-width="2"
         stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <polyline points="21 15 16 10 5 21"/>
    </svg>
    <span class="orb-ring"></span>`;

if (micBtn) {
    micBtn.parentNode.insertBefore(imageBtn, micBtn);
} else {
    sendBtn.parentNode.insertBefore(imageBtn, sendBtn);
}

imageBtn.addEventListener(
"click",
function() {
imageInput.click();
}
);

/* =========================================
SELECTED IMAGE
========================================= */

let selectedImage = null;

/* =========================================
CAMERA — LIVE PREVIEW + CAPTURE & ANALYZE
========================================= */

const cameraBtn     = document.getElementById("cameraBtn");
const camModal      = document.getElementById("camModal");
const camVideo      = document.getElementById("camVideo");
const camCloseBtn   = document.getElementById("camCloseBtn");
const camCaptureBtn = document.getElementById("camCaptureBtn");

let camStream = null;

async function openCamera() {
    try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        camVideo.srcObject = camStream;
        camModal.classList.remove("hidden");
        cameraBtn.classList.add("active");
    } catch (err) {
        createMessage("Camera access denied or unavailable.", "ai");
    }
}

function closeCamera() {
    if (camStream) {
        camStream.getTracks().forEach(function(t) { t.stop(); });
        camStream = null;
    }
    camModal.classList.add("hidden");
    cameraBtn.classList.remove("active");
}

function captureAndAnalyze() {
    if (!camStream || !camVideo.videoWidth) return;

    const c = document.createElement("canvas");
    c.width  = camVideo.videoWidth;
    c.height = camVideo.videoHeight;
    c.getContext("2d").drawImage(camVideo, 0, 0);

    c.toBlob(function(blob) {
        if (!blob) return;

        selectedImage = new File([blob], "camera-capture.jpg", { type: "image/jpeg" });

        createMessage("📷 Captured — press send to analyze", "user");
        closeCamera();
        messageInput.focus();
    }, "image/jpeg", 0.9);
}

if (cameraBtn) {
    cameraBtn.addEventListener("click", function() {
        camStream ? closeCamera() : openCamera();
    });
}
if (camCloseBtn)   camCloseBtn.addEventListener("click", closeCamera);
if (camCaptureBtn) camCaptureBtn.addEventListener("click", captureAndAnalyze);
imageInput.addEventListener(
"change",
function() {

    const file =
        imageInput.files[0];

    if (!file) {
        return;
    }

    selectedImage = file;

    createMessage(
        "📷 Image selected: " +
        file.name,
        "user"
    );

    messageInput.focus();
}

);

/* =========================================
SEND MESSAGE
========================================= */

async function sendMessage() {

const text =
    messageInput.value.trim();

if (
    text === "" &&
    !selectedImage
) {
    return;
}

if (welcomeScreen) {
    welcomeScreen.style.display =
        "none";
}

if (text !== "") {

    createMessage(
        text,
        "user"
    );
}

messageInput.value = "";

const typing =
    createMessage(
        "NANI AI is thinking...",
        "ai"
    );

try {

    let response;

    /* =================================
       IMAGE REQUEST
    ================================= */

    if (selectedImage) {

        const base64Image =
            await fileToBase64(
                selectedImage
            );

        response =
            await fetch(
                BACKEND_URL +
                "/api/image",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",
                      "Authorization":
                            "Bearer " + authToken
                    },

                    body: JSON.stringify({

                        message:
                            text ||
                            "Describe this image.",

                        image:
                            base64Image

                    })
                }
            );

    }

    /* =================================
       NORMAL TEXT REQUEST
    ================================= */

            else {

        response =
            await fetch(
                BACKEND_URL +
                "/api/chat",
                {
                    method: "POST",

                    headers: {
                        "Content-Type":
                            "application/json",

                        "Authorization":
                            "Bearer " + authToken
                    },

                    body: JSON.stringify({
                        message: text
                    })
                }
            );
            }

    if (!response.ok) {

        throw new Error(
            "Backend returned status " +
            response.status
        );
    }

    const data =
        await response.json();

    typing.remove();

    if (data.success) {

        createMessage(
            data.response,
            "ai"
        );

    } else {

        createMessage(
            "Backend error: " +
            (
                data.error ||
                "Unknown error"
            ),
            "ai"
        );
    }

} catch (error) {

    console.error(
        "NANI AI error:",
        error
    );

    typing.remove();

    createMessage(
        "❌ Error: " + error.message,
        "ai"
    );
}

selectedImage = null;
imageInput.value = "";

scrollToBottom();

}

/* =========================================
FILE TO BASE64
========================================= */

function fileToBase64(file) {

return new Promise(
    function(resolve, reject) {

        if (!file || file.size === 0) {

            reject(new Error("Selected file is empty or invalid."));

            return;
        }

        if (file.size > 8 * 1024 * 1024) {

            reject(new Error("Image is too large. Please choose a photo under 8MB."));

            return;
        }

        const reader =
            new FileReader();

        reader.onload =
            function() {

                resolve(
                    reader.result
                );
            };

        reader.onerror =
            function() {

                reject(new Error(
                    reader.error
                        ? reader.error.message
                        : "Could not read the selected file."
                ));
            };

        reader.readAsDataURL(file);
    }
);

}

/* =========================================
CREATE MESSAGE
========================================= */

function escapeHtml(text) {

    const div =
        document.createElement("div");

    div.textContent = text;

    return div.innerHTML;
}

function formatMessage(text) {

    const codeParts =
        text.split(/```([a-zA-Z0-9]*)\n?([\s\S]*?)```/g);

    let html = "";

    for (let i = 0; i < codeParts.length; i++) {

        if (i % 3 === 2) {

            html +=
                "<pre><code>" +
                escapeHtml(codeParts[i]) +
                "</code></pre>";

            continue;
        }

        if (i % 3 !== 0) {
            continue;
        }

        let segment =
            escapeHtml(codeParts[i]);

        segment = segment.replace(
            /^### (.+)$/gm,
            "<h3>$1</h3>"
        );

        segment = segment.replace(
            /^## (.+)$/gm,
            "<h2>$1</h2>"
        );

        segment = segment.replace(
            /\*\*(.+?)\*\*/g,
            "<strong>$1</strong>"
        );

        segment = segment.replace(
            /`([^`]+)`/g,
            "<code class=\"inline-code\">$1</code>"
        );

        segment = segment.replace(
            /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
            "<a href=\"$2\" target=\"_blank\" rel=\"noopener\">$1</a>"
        );

        segment = segment.replace(
            /^(?:\* |- )(.+)$/gm,
            "<li>$1</li>"
        );

        segment = segment.replace(
            /(<li>.*<\/li>)/gs,
            "<ul>$1</ul>"
        );

        segment = segment.replace(
            /\n{2,}/g,
            "<br><br>"
        );

        segment = segment.replace(
            /\n/g,
            "<br>"
        );

        html += segment;
    }

    return html;
}

function createMessage(
text,
sender
) {

const message =
    document.createElement("div");

message.className =
    "message " +
    (
        sender === "user"
            ? "user-message"
            : "ai-message"
    );

if (sender === "user") {

    message.textContent =
        text;

} else {

    message.innerHTML =
        formatMessage(text);
}

chatArea.appendChild(
    message
);

scrollToBottom();

return message;

}

/* =========================================
NEW CHAT
========================================= */

if (newChatBtn) {

newChatBtn.addEventListener(
    "click",
    function() {

        chatArea.innerHTML = "";

        if (welcomeScreen) {

            chatArea.appendChild(
                welcomeScreen
            );

            welcomeScreen.style.display =
                "block";
        }

        messageInput.value = "";

        selectedImage = null;

        imageInput.value = "";

        messageInput.focus();
    }
);

}

/* =========================================
SEND BUTTON
========================================= */

if (sendBtn) {

sendBtn.addEventListener(
    "click",
    sendMessage
);

}

/* =========================================
ENTER KEY
========================================= */

if (messageInput) {

messageInput.addEventListener(
    "keydown",
    function(event) {

        if (
            event.key === "Enter" &&
            !event.shiftKey
        ) {

            event.preventDefault();

            sendMessage();
        }
    }
);

}

/* =========================================
QUICK ACTIONS
========================================= */
quickButtons.forEach(function(button) {

    button.addEventListener("click", function() {

        const label = button.querySelector(
            "span:not(.qb-icon):not(.qb-bracket)"
        );

        if (!label) return;

        messageInput.value = "Tell me about " + label.textContent.trim();
        messageInput.focus();
    });
});

/* =========================================
SCROLL
========================================= */

function scrollToBottom() {


if (chatArea) {

    chatArea.scrollTop =
        chatArea.scrollHeight;
}

}
/* =========================================
MATRIX BACKGROUND EFFECT
========================================= */

(function() {

    const canvas = document.getElementById("matrixCanvas");

    if (!canvas) {
        return;
    }

    const ctx = canvas.getContext("2d");

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    const characters = "01";
    const fontSize = 16;
    let columns = Math.floor(canvas.width / fontSize);
    let drops = new Array(columns).fill(1);

    function draw() {

        ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        ctx.fillStyle = "#00ff66";
        ctx.font = fontSize + "px monospace";

        for (let i = 0; i < drops.length; i++) {

            const text =
                characters.charAt(
                    Math.floor(Math.random() * characters.length)
                );

            ctx.fillText(text, i * fontSize, drops[i] * fontSize);

            if (
                drops[i] * fontSize > canvas.height &&
                Math.random() > 0.975
            ) {
                drops[i] = 0;
            }

            drops[i]++;
        }
    }

    setInterval(draw, 50);

})();

/* =========================================
TERMINAL TYPING EFFECT (welcome subtitle)
========================================= */

(function() {

    const subtitle = document.querySelector(".welcome p");

    if (!subtitle) {
        return;
    }

    const fullText = subtitle.textContent;

    subtitle.textContent = "";

    let i = 0;

    function typeChar() {

        if (i < fullText.length) {

            subtitle.textContent += fullText.charAt(i);

            i++;

            setTimeout(typeChar, 35);
        }
    }

    typeChar();

})();