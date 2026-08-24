const express = require('express');
const PORT = process.env.PORT || 3000;

const app = express();

// All booking/business logic and the admin dashboard live entirely in static
// files + Supabase (Postgres + RLS + Edge Functions) — this server is just a
// static file host, used for local development. It has no bearing on the
// GitHub Pages deployment, which serves these same files directly.
//
// `extensions:['html']` mirrors GitHub Pages' own clean-URL behavior locally:
// a request for /login resolves to login.html without a redirect.
app.use(express.static(__dirname, { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`GGS Studio server running at http://localhost:${PORT}`);
});
