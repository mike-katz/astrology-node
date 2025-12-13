const { io } = require("socket.io-client");

const socket = io("http://13.204.207.15:3001", {
    transports: ["websocket"],
    autoConnect: true,
});

socket.on("connect", () => {
    console.log("API connected to Socket Server:", socket.id);
});

socket.on("connect_error", (err) => {
    console.error("Socket connect error:", err.message);
});

module.exports = socket;
