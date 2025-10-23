// ============================================
// File: server.js - WITHOUT REQUEST FEATURES
// ============================================
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// MongoDB Connection
mongoose.connect('mongodb://localhost:27017/fooddonation', {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).catch(err => {
  console.error('MongoDB connection failed:', err);
  process.exit(1);
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', () => {
  console.log('Connected to MongoDB successfully');
});

// User Schema
const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  phone: { type: String, required: true },
  userType: { type: String, enum: ['donor', 'receiver'], required: true },
  address: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

// Food Donation Schema
const donationSchema = new mongoose.Schema({
  donorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  donorName: { type: String, required: true },
  donorPhone: { type: String, required: true },
  foodName: { type: String, required: true },
  quantity: { type: String, required: true },
  category: { type: String, required: true },
  description: { type: String },
  pickupAddress: { type: String, required: true },
  expiryTime: { type: String, required: true },
  status: { type: String, enum: ['available', 'claimed', 'completed'], default: 'available' },
  receiverId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  receiverName: { type: String },
  receiverPhone: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Donation = mongoose.model('Donation', donationSchema);

// JWT Secret
const JWT_SECRET = 'your_jwt_secret_key_here_change_in_production';

// Middleware to verify token
const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'No token provided' });
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.userId;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Invalid token' });
  }
};

// ============================================
// ROUTES
// ============================================

// Health Check Endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbState = mongoose.connection.readyState;
    if (dbState === 1) {
      res.json({ 
        status: 'healthy', 
        database: 'connected',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(503).json({ 
        status: 'unhealthy', 
        database: 'disconnected' 
      });
    }
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy', 
      error: error.message 
    });
  }
});

// Statistics Endpoint
app.get('/api/stats', async (req, res) => {
  try {
    const totalDonations = await Donation.countDocuments();
    const activeDonations = await Donation.countDocuments({ status: 'available' });
    const claimedDonations = await Donation.countDocuments({ status: 'claimed' });
    const totalUsers = await User.countDocuments();
    const donors = await User.countDocuments({ userType: 'donor' });
    const receivers = await User.countDocuments({ userType: 'receiver' });
    
    const recentDonations = await Donation.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .select('foodName status createdAt donorName');
    
    const recentActivity = recentDonations.map(d => ({
      action: `${d.donorName} donated ${d.foodName} - Status: ${d.status}`,
      timestamp: d.createdAt
    }));

    res.json({
      totalDonations,
      activeDonations,
      claimedDonations,
      totalUsers,
      donors,
      receivers,
      recentActivity
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching stats', error: error.message });
  }
});

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { name, email, password, phone, userType, address } = req.body;
    
    if (!name || !email || !password || !phone || !userType || !address) {
      return res.status(400).json({ message: 'All fields are required' });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new User({
      name,
      email,
      password: hashedPassword,
      phone,
      userType,
      address
    });

    await user.save();
    
    res.status(201).json({ 
      message: 'User registered successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        userType: user.userType
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration', error: error.message });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid email or password' });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: '24h' });
    
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        userType: user.userType,
        phone: user.phone,
        address: user.address
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ message: 'Server error during login', error: error.message });
  }
});

// Create Donation
app.post('/api/donations', verifyToken, async (req, res) => {
  try {
    const { foodName, quantity, category, description, pickupAddress, expiryTime } = req.body;
    
    if (!foodName || !quantity || !category || !pickupAddress || !expiryTime) {
      return res.status(400).json({ message: 'All required fields must be filled' });
    }

    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.userType !== 'donor') {
      return res.status(403).json({ message: 'Only donors can create donations' });
    }

    const donation = new Donation({
      donorId: req.userId,
      donorName: user.name,
      donorPhone: user.phone,
      foodName,
      quantity,
      category,
      description,
      pickupAddress,
      expiryTime,
      status: 'available'
    });

    await donation.save();
    
    res.status(201).json({ 
      message: 'Donation created successfully', 
      donation 
    });
  } catch (error) {
    console.error('Create donation error:', error);
    res.status(500).json({ message: 'Server error creating donation', error: error.message });
  }
});

// Get all available donations
app.get('/api/donations', async (req, res) => {
  try {
    const donations = await Donation.find({ status: 'available' })
      .sort({ createdAt: -1 });
    res.json(donations);
  } catch (error) {
    console.error('Fetch donations error:', error);
    res.status(500).json({ message: 'Server error fetching donations', error: error.message });
  }
});

// Get user's donations (for donors)
app.get('/api/donations/my-donations', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.userType !== 'donor') {
      return res.status(403).json({ message: 'Only donors can view their donations' });
    }

    const donations = await Donation.find({ donorId: req.userId })
      .sort({ createdAt: -1 });
    res.json(donations);
  } catch (error) {
    console.error('Fetch my donations error:', error);
    res.status(500).json({ message: 'Server error fetching your donations', error: error.message });
  }
});

// Claim donation (for receivers)
app.put('/api/donations/:id/claim', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.userType !== 'receiver') {
      return res.status(403).json({ message: 'Only receivers can claim donations' });
    }

    const donation = await Donation.findById(req.params.id);
    if (!donation) {
      return res.status(404).json({ message: 'Donation not found' });
    }

    if (donation.status !== 'available') {
      return res.status(400).json({ message: 'This donation is no longer available' });
    }

    donation.status = 'claimed';
    donation.receiverId = req.userId;
    donation.receiverName = user.name;
    donation.receiverPhone = user.phone;
    
    await donation.save();
    
    res.json({ 
      message: 'Donation claimed successfully', 
      donation 
    });
  } catch (error) {
    console.error('Claim donation error:', error);
    res.status(500).json({ message: 'Server error claiming donation', error: error.message });
  }
});

// Get claimed donations for receiver
app.get('/api/donations/claimed', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.userType !== 'receiver') {
      return res.status(403).json({ message: 'Only receivers can view claimed items' });
    }

    const donations = await Donation.find({ receiverId: req.userId })
      .sort({ createdAt: -1 });
    res.json(donations);
  } catch (error) {
    console.error('Fetch claimed donations error:', error);
    res.status(500).json({ message: 'Server error fetching claimed donations', error: error.message });
  }
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ message: 'Internal server error', error: err.message });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Health check available at http://localhost:${PORT}/api/health`);
  console.log(`Stats available at http://localhost:${PORT}/api/stats`);
});