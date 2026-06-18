require('dotenv').config();

const mongoose = require('mongoose');
const path = require('path');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      connectTimeoutMS: 5000
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return conn;
  } catch (error) {
    console.warn('MongoDB not available:', error.message);
    console.warn('Server will start but database features will be unavailable.');
    console.warn('Install MongoDB or set MONGODB_URI in .env to a valid MongoDB instance.');
    return null;
  }
};

module.exports = connectDB;