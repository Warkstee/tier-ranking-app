/**
 * Authentication route handlers
 */
import { getDb } from "../db.js";
import { 
  hashPassword, 
  verifyPassword, 
  generateToken, 
  verifyToken, 
  setAuthCookie, 
  clearAuthCookie, 
  extractToken 
} from "../auth.js";
import { readBody } from "../utils/request.js";

export async function handleAuthRoutes(req, res) {
  /**
   * @swagger
   * /api/auth/signup:
   *   post:
   *     summary: Register a new user
   *     description: >
   *       Creates a new user account with the provided username and password.
   *       The username must be 3-30 alphanumeric characters. The password must
   *       be at least 8 characters. On success, a session cookie is set.
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               username:
   *                 type: string
   *                 description: Alphanumeric username (3-30 characters)
   *                 example: "fross"
   *               password:
   *                 type: string
   *                 description: Password (minimum 8 characters)
   *                 example: "secret123"
   *     responses:
   *       201:
   *         description: User created successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 userId:
   *                   type: integer
   *                   example: 1
   *                 username:
   *                   type: string
   *                   example: "fross"
   *       400:
   *         description: Invalid username or password
   *       409:
   *         description: Username already exists
   *       500:
   *         description: Signup failed
   */
  if (req.method === "POST" && req.url === "/api/auth/signup") {
    try {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body);
      
      // Validate username
      if (!username || typeof username !== 'string' || username.length < 3 || username.length > 30) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Username must be 3-30 characters" }));
        return;
      }
      
      // Validate username format (alphanumeric only)
      if (!/^[a-zA-Z0-9]+$/.test(username)) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Username must be alphanumeric" }));
        return;
      }
      
      // Validate password
      if (!password || typeof password !== 'string' || password.length < 8) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Password must be at least 8 characters" }));
        return;
      }
      
      const db = getDb();
      
      // Check if username already exists
      const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (existing) {
        res.writeHead(409, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Username already exists" }));
        return;
      }
      
      // Hash password and create user
      const passwordHash = await hashPassword(password);
      const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, passwordHash);
      const userId = result.lastInsertRowid;
      
      // Generate token and set cookie
      const token = generateToken(userId, username);
      setAuthCookie(res, token);
      
      res.writeHead(201, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, userId, username }));
    } catch (err) {
      console.error("Signup error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Signup failed" }));
    }
    return;
  }
  
  /**
   * @swagger
   * /api/auth/login:
   *   post:
   *     summary: Authenticate a user
   *     description: >
   *       Validates the provided credentials and returns a session cookie
   *       on success.
   *     tags: [Auth]
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               username:
   *                 type: string
   *                 example: "fross"
   *               password:
   *                 type: string
   *                 example: "secret123"
   *     responses:
   *       200:
   *         description: Login successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   *                 userId:
   *                   type: integer
   *                   example: 1
   *                 username:
   *                   type: string
   *                   example: "fross"
   *       400:
   *         description: Username and password required
   *       401:
   *         description: Invalid credentials
   *       500:
   *         description: Login failed
   */
  if (req.method === "POST" && req.url === "/api/auth/login") {
    try {
      const body = await readBody(req);
      const { username, password } = JSON.parse(body);
      
      if (!username || !password) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Username and password required" }));
        return;
      }
      
      const db = getDb();
      const user = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
      
      if (!user) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid credentials" }));
        return;
      }
      
      const validPassword = await verifyPassword(password, user.password_hash);
      if (!validPassword) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid credentials" }));
        return;
      }
      
      // Generate token and set cookie
      const token = generateToken(user.id, user.username);
      setAuthCookie(res, token);
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true, userId: user.id, username: user.username }));
    } catch (err) {
      console.error("Login error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Login failed" }));
    }
    return;
  }
  
  /**
   * @swagger
   * /api/auth/logout:
   *   post:
   *     summary: Log out the current user
   *     description: >
   *       Clears the session cookie, effectively logging the user out.
   *     tags: [Auth]
   *     responses:
   *       200:
   *         description: Logout successful
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 success:
   *                   type: boolean
   *                   example: true
   */
  if (req.method === "POST" && req.url === "/api/auth/logout") {
    clearAuthCookie(res);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ success: true }));
    return;
  }
  
  /**
   * @swagger
   * /api/auth/me:
   *   get:
   *     summary: Get current user info
   *     description: >
   *       Returns the authenticated user's ID and username based on
   *       the session cookie.
   *     tags: [Auth]
   *     responses:
   *       200:
   *         description: User info retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 userId:
   *                   type: integer
   *                   example: 1
   *                 username:
   *                   type: string
   *                   example: "fross"
   *       401:
   *         description: Not authenticated or invalid token
   *       500:
   *         description: Auth check failed
   */
  if (req.method === "GET" && req.url === "/api/auth/me") {
    try {
      const token = extractToken(req);
      if (!token) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not authenticated" }));
        return;
      }
      
      const payload = verifyToken(token);
      if (!payload) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid token" }));
        return;
      }
      
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ userId: payload.userId, username: payload.username }));
    } catch (err) {
      console.error("Auth check error:", err);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Auth check failed" }));
    }
    return;
  }
}
