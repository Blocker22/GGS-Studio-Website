const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// All booking/business logic now lives in Supabase (Postgres + RLS + Edge
// Functions) — this server just serves the static public site and the built
// admin dashboard.
app.use(express.static(__dirname));

const ADMIN_DIST = path.join(__dirname, 'admin-app', 'dist');
app.use('/admin', express.static(ADMIN_DIST));
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(ADMIN_DIST, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`GGS Studio server running at http://localhost:${PORT}`);
});
