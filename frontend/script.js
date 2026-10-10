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
imageInput.setAttribute("capture", "environment");
imageInput.style.display = "none";

document.body.appendChild(imageInput);

/* =========================================
IMAGE BUTTON
========================================= */

const imageBtn = document.createElement("button");

imageBtn.type = "button";
imageBtn.className = "icon-btn";
imageBtn.textContent = "📷";
imageBtn.title = "Analyze an image";

if (micBtn) {
micBtn.parentNode.insertBefore(
imageBtn,
micBtn
);
} else {
sendBtn.parentNode.insertBefore(
imageBtn,
sendBtn
);
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
        "❌ NANI AI could not process the request.",
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

        const reader =
            new FileReader();

        reader.onload =
            function() {

                resolve(
                    reader.result
                );
            };

        reader.onerror =
            function(error) {

                reject(error);
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

quickButtons.forEach(
function(button) {

    button.addEventListener(
        "click",
        function() {

            const span =
                button.querySelector(
                    "span"
                );

            if (!span) {
                return;
            }

            messageInput.value =
                "Tell me about " +
                span.textContent;

            messageInput.focus();
        }
    );
}

);

/* =========================================
SCROLL
========================================= */

function scrollToBottom() {


if (chatArea) {

    chatArea.scrollTop =
        chatArea.scrollHeight;
}

}
