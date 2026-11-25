// Adds sample reader comments so the site doesn't look empty while you test it.
// They are tagged as samples: they are left out of the search-engine structured data,
// and one command removes them all before launch.
//
//   npm run sample-comments            add samples (skips articles that already have them)
//   npm run sample-comments -- --clear remove every sample comment
import { db, refreshCommentCount } from '../src/db.js';

const SAMPLES = {
  'dj-khaled-spotted-sotto-sotto-toronto': [
    ['Lucia M', 'The tiramisu part made me laugh out loud. ANOTHER ONE'],
    ['yorkvillegrump', 'Sotto Sotto is the last place I would expect him. Not buying it.'],
    ['Teresa', 'My cousin works on Avenue Rd and said there were SUVs outside that week, so who knows!'],
    ['Mo', 'lol the sister giving her that look is the realest part'],
  ],
  'ryan-gosling-spotted-kost-at-bisha-hotel-toronto': [
    ['kenergy_416', 'the birthday sash detail is sending me. happy birthday to your cousin'],
    ['Brittany', 'I was at Bisha that night!! There was definitely a buzz on the rooftop'],
    ['Darren P.', 'Every week somebody "sees" Ryan Gosling in Toronto. He can not be in this many places.'],
    ['sam', 'pics or it didnt happen'],
    ['Joanne W', 'Honestly sounds just like him. He always seems so low key.'],
  ],
  'christina-milian-spotted-st-lawrence-market-toronto': [
    ['Gord’s daughter', 'Dad you forgot to mention you asked her if she was "from the TV." Love you'],
    ['peamealfan', 'Carousel Bakery line is undefeated. Even celebs have to wait lol'],
    ['Ashley R', 'Dip It Low was my JAM in grade 8. I would have passed out'],
    ['Kev', 'Kind of a stretch calling this a celebrity sighting when the guy did not know who she was'],
  ],
  'the-weeknd-spotted-bar-raval-toronto': [
    ['xo_tilldeath', 'If it was him he wants privacy. Let the man eat his croquetas'],
    ['Nadia’s roommate', 'For the record I still say 40 percent'],
    ['Matt C', 'This is basically "I saw a tall guy in a jacket." Come on.'],
    ['Priyanka', 'Raval at midnight on a Friday is so him tho'],
  ],
  'will-smith-spotted-distillery-historic-district-toronto': [
    ['Chantal', 'Walking into the sign is exactly what I would do. Respect for admitting it'],
    ['raptorsfan4life', 'Raps over Philly this year. Tell Will I said that'],
    ['Steve O', 'Distillery gets film crews every week, this one actually makes sense'],
    ['jen.b', 'Not sure I believe this one. Feels a bit made up.'],
    ['Ben’s girlfriend', 'Make that twelve people now. Sorry babe'],
  ],
  'alexander-skarsgard-spotted-pai-northern-thai-kitchen-toronto': [
    ['Erik S', 'Hej från Uppsala! Love that he spoke Swedish with you'],
    ['Maya', 'I was there. I can confirm I understood nothing and it was still amazing'],
    ['Lorraine', 'He is very tall in real life, my friend met him once. The stairs detail checks out'],
    ['tomtom', 'mild because he is Scandinavian lmao'],
  ],
  'angelina-jolie-spotted-vinny-king-west-toronto': [
    ['vinylhead_TO', 'Side B request is elite. Whoever this is, they have taste'],
    ['Carmen', 'Vinny is gorgeous, been twice. Did not see any celebs though'],
    ['Rich', 'Angelina Jolie at a King West bar on a Saturday? Very doubtful.'],
    ['Dev P.', 'Update: the selector told me she came back the next night. Still haven’t recovered'],
  ],
  'oscar-isaac-spotted-kiin-toronto': [
    ['Ximena', '¡Qué bonito! My family is from Antigua, this made me so happy'],
    ['Rob N.', 'Can confirm. I was the husband. The fish really was life changing'],
    ['moviebuff_88', 'Love this. He seems like one of the genuinely nice ones'],
    ['Andrea', 'No photo, no proof. Sorry Carla, your mom is right'],
  ],
  'stephen-curry-spotted-silent-h-toronto': [
    ['Dre', 'I am never washing this jersey. Ever.'],
    ['hoopsTO', 'Basically a local is right. He went to school in Etobicoke!'],
    ['Paul G', 'Warriors were in town that week so maybe, but this sounds a little too perfect'],
    ['Nina', 'Silent H at 11:30 is always a vibe. Not surprised at all'],
    ['grumpy_jays_fan', 'Who cares, he still dropped buckets on us'],
  ],
  'benny-blanco-spotted-prime-seafood-palace-toronto': [
    ['Hannah’s roommate', 'He was right about the bread. Best birthday ever'],
    ['Marcus T', 'This is 100 percent on brand for him lol'],
    ['foodie_416', 'Saving up two months for one dinner is too real'],
    ['Kelly', 'Kind of a nothing story. Guy liked his steak, ok'],
  ],
  'joe-jonas-spotted-adrak-yorkville-toronto': [
    ['Simran', 'Every aunty in Brampton is cheering for Pinky Aunty right now'],
    ['jonasfan2008', 'NOT the 2008 bedroom posters. I felt that'],
    ['Raj', '"Very good manners, that boy" is the highest compliment possible from a desi mom'],
    ['Lindsay', 'Cute but I think this one is a bit exaggerated'],
    ['Anjali R.', 'Update: Pinky Aunty now tells everyone she "works with" Joe Jonas'],
  ],
  'russell-crowe-spotted-estiatorio-milos-toronto': [
    ['Liam from Sydney', 'Go Souths! Love that he talked footy with your client'],
    ['BayStBro', 'Milos at lunch is basically a Bay Street board meeting. Makes sense'],
    ['Heather', 'The business outcome section is hilarious'],
    ['Craig', 'Russell Crowe on Bay Street on a Thursday? I will believe it when I see it'],
  ],
  'davis-schneider-spotted-jacobs-and-co-steakhouse-toronto': [
    ['Gary', 'For the record I know who he is NOW'],
    ['MoustacheMafia', 'The little moustache next to the autograph is the best thing I have read all week'],
    ['Tanya', 'Happy 35th Bev and Gary!! Frame that napkin'],
    ['jaysthoughts', 'Nice story but I would rather hear about him hitting'],
    ['Sandra K', 'Bev you are the fan we all aspire to be'],
  ],
};

if (process.argv.includes('--clear')) {
  const ids = db.prepare("SELECT DISTINCT article_id FROM comments WHERE visitor = 'sample'").all();
  const r = db.prepare("DELETE FROM comments WHERE visitor = 'sample'").run();
  for (const { article_id } of ids) refreshCommentCount(article_id);
  console.log(`Removed ${r.changes} sample comment(s).`);
  process.exit(0);
}

const insert = db.prepare("INSERT INTO comments (article_id, name, body, status, visitor, created_at) VALUES (?,?,?, 'visible', 'sample', ?)");
let added = 0;
for (const [slug, list] of Object.entries(SAMPLES)) {
  const a = db.prepare('SELECT id, published_at FROM articles WHERE slug = ?').get(slug);
  if (!a) { console.log('skip (no article):', slug); continue; }
  if (db.prepare("SELECT 1 FROM comments WHERE article_id = ? AND visitor = 'sample'").get(a.id)) continue;
  const start = new Date(a.published_at).getTime();
  const span = Math.max(60_000, Date.now() - start);
  // Spread comments out after the article went live, oldest first.
  const times = list.map(() => start + Math.random() * span).sort((x, y) => x - y);
  list.forEach(([name, body], i) => { insert.run(a.id, name, body, new Date(times[i]).toISOString()); added++; });
  refreshCommentCount(a.id);
}
console.log(`Added ${added} sample comment(s).`);
