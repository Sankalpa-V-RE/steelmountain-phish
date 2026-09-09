const express = require('express');
const app = express();
const PORT = 4000;

app.use(express.json());

// Mock inbox containing a verification request email
let mailbox = [
  {
    _id: "test-email-id-001",
    from: "player@example.com",
    to: "r.gunderson",
    subject: "Verification Request: SM-REQ-123456",
    body: "Please review the request at: http://localhost:8080/login.html",
    timestamp: new Date().toISOString()
  }
];

// Endpoint matching the Mail API endpoint
app.get('/api/team/public/mail/all', (req, res) => {
  const { secret, teamName } = req.query;
  console.log(`Received request. Secret: ${secret}, TeamName: ${teamName}`);
  res.json(mailbox);
});

app.listen(PORT, () => {
  console.log(`Mock Mail API Server running on http://localhost:${PORT}`);
  console.log(`Endpoint: http://localhost:${PORT}/api/team/public/mail/all`);
});
