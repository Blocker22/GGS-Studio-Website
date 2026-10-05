// A small profanity check shared by the feedback page and public-api, so the
// browser can warn before sending and the server refuses the same words.
// English plus common Tagalog and Cebuano swears. Matches whole words only,
// so "class" or "Scunthorpe" pass.

const WORDS = [
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bullshit', 'bitch', 'bastard', 'asshole', 'dick', 'cunt',
  'slut', 'whore', 'nigger', 'nigga', 'faggot', 'retard',
  'putangina', 'putang ina', 'tangina', 'tang ina', 'gago', 'gaga', 'tarantado', 'tanga', 'bobo', 'ulol', 'pakyu',
  'kupal', 'leche', 'punyeta', 'hayop ka', 'pokpok', 'puke', 'titi', 'burat', 'kantot',
  'yawa', 'pisti', 'buang', 'giatay', 'animal ka', 'bilat', 'oten',
];

const RE = new RegExp(`(^|[^a-z])(${WORDS.map((w) => w.replace(/\s+/g, '\\s*')).join('|')})(?=$|[^a-z])`, 'i');

export function hasProfanity(text) {
  return RE.test(String(text || '').toLowerCase());
}
