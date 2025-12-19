// const { io } = require("socket.io-client");
const WebSocket = require('ws');

const socket = new WebSocket('wss://socket.astrotalkguruji.com');

// const socket = io("http://localhost:3001", {
// const socket = io("https://socket.astrotalkguruji.com", {
//     transports: ["websocket"],
//     autoConnect: true,
// });
// socket.onopen = () => console.log('Connected');
// socket.on('message', (JSON.stringify({ event: "emit_to_user_for_register", key: "user_27" })) => {
//     console.log('Received:');
// });
// socket.send(JSON.stringify({
//     event: "emit_to_user_for_register",
//     key: "user_27"
// }));
// socket.onclose = () => console.log('Disconnected');



socket.on('open', () => {
    console.log('Connected');
});

socket.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Received:', msg);
});

socket.on('close', () => {
    console.log('Disconnected');
});
module.exports = socket;
