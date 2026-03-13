require('dotenv').config();
const { MongoClient } = require('mongodb');

// Connection URL - we might need to adjust this based on your local setup
const url = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(url);

// Database Name
const dbName = 'nationalSystemDb'; // Using a more specific name for our project

async function main() {
  try {
    // Use connect method to connect to the server
    await client.connect();
    console.log('Connected successfully to the MongoDB server!');

    const db = client.db(dbName);
    const collection = db.collection('connection_tests');

    // A simple test: insert a document and then find it
    const insertResult = await collection.insertOne({ test: 'hello', timestamp: new Date() });
    console.log('Inserted a test document =>', insertResult);

    const findResult = await collection.find({ _id: insertResult.insertedId }).toArray();
    console.log('Found the test document =>', findResult);

    console.log('Database connection test successful.');
    return 'done.';

  } catch (err) {
    console.error('Database connection test failed:', err);
    // Ensure we throw the error so the process exits with a non-zero code on failure
    throw err;
  } finally {
    // Ensures that the client will close when you finish/error
    await client.close();
    console.log('Connection closed.');
  }
}

main()
  .then(console.log)
  .catch(() => process.exit(1));