let socket;

function initChat() {
  socket = io("http://localhost:5000", {
    auth: { token: getToken() }
  });

  socket.on("message", addMessage);
}

function sendMessage() {
  const text = messageInput.value;
  socket.emit("message", text);
  messageInput.value = "";
}

function addMessage(msg) {
  const div = document.createElement("div");
  div.textContent = `${msg.sender}: ${msg.text}`;
  chatBox.appendChild(div);
}
