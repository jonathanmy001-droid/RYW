// ================================================
//          socket/chatHandler.js
// ================================================
// Encapsulates all real-time chat logic using Socket.IO

function initializeChat(io) {
  // Listen for a new connection from a client
  io.on('connection', (socket) => {
    console.log(`A user connected with socket ID: ${socket.id}`);

    // Broadcast a message to all other clients when a user connects
    socket.broadcast.emit('user connected', {
      socketID: socket.id,
      message: 'A new user has joined the chat!',
    });

    // Listen for incoming chat messages from a client
    socket.on('chat message', (msg) => {
      if (!msg) return; // Prevent sending empty messages

      console.log(`Message from ${socket.id}: ${msg}`);
      // Emit the received message to ALL clients (including the sender)
      io.emit('chat message', {
        from: socket.id,
        message: msg,
        timestamp: new Date()
      });
    });

    // Listen for the 'disconnect' event
    socket.on('disconnect', () => {
      console.log(`User with socket ID: ${socket.id} disconnected`);
      io.emit('user disconnected', {
        socketID: socket.id,
        message: 'A user has left the chat.',
      });
    });
  });
}

module.exports = initializeChat;