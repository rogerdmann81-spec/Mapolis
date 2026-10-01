// assets/game-catalog.js
// Catalog data for Mapolis: Badges, Preserve Animals, and image helpers.
// Loaded by both play/index.html and admin/index.html.



const BADGE_DEFS = [
  // ── Volume ──
  { id:'vol_1',   cp:'1f3ae', name:'Hello, World',  desc:'Complete your first game', check:s=>(s.gamesPlayed||0)>=1 },
  { id:'vol_10',  cp:'1f51f', name:'Take Ten',      desc:'Play 10 games',            check:s=>(s.gamesPlayed||0)>=10 },
  { id:'vol_50',  cp:'1f3c5', name:'Half-Century',  desc:'Play 50 games',            check:s=>(s.gamesPlayed||0)>=50 },
  { id:'vol_100', cp:'1f4af', name:'The Cent',      desc:'Play 100 games',           check:s=>(s.gamesPlayed||0)>=100 },
  { id:'vol_200', cp:'1f3c6', name:'Double Century',desc:'Play 200 games',           check:s=>(s.gamesPlayed||0)>=200 },

  // ── In-game streaks ──
  { id:'stk_5',  cp:'1f525', name:'On a Roll',       desc:'5-answer streak',  check:s=>(s.bestStreak||0)>=5 },
  { id:'stk_10', cp:'1f4a5', name:'Combo Breaker',   desc:'10-answer streak', check:s=>(s.bestStreak||0)>=10 },
  { id:'stk_20', cp:'26a1',  name:'Chain Lightning', desc:'20-answer streak', check:s=>(s.bestStreak||0)>=20 },
  { id:'stk_50', cp:'1f300', name:'Streak-zilla',    desc:'50-answer streak', check:s=>(s.bestStreak||0)>=50 },

  // ── Daily streak ──
  { id:'day_3',  cp:'1f4c5', name:'Daily Driver',  desc:'Play 3 days in a row',  check:s=>(s.currentDayStreak||0)>=3 },
  { id:'day_7',  cp:'1f4c6', name:'Week Warrior',  desc:'Play 7 days in a row',  check:s=>(s.currentDayStreak||0)>=7 },
  { id:'day_30', cp:'1f31e', name:'Month Marcher', desc:'Play 30 days in a row', check:s=>(s.currentDayStreak||0)>=30 },

  // ── Speed ──
  { id:'spd_3', cp:'23f1',  name:'Quick Draw',    desc:'Average under 3 sec / answer in a 10+ card game',
    check:(s,r)=>r&&r.answerTimes&&r.answerTimes.length>=10&&(r.answerTimes.reduce((a,b)=>a+b,0)/r.answerTimes.length)<3000 },
  { id:'spd_2', cp:'1f4a8', name:'Speed of Sound',desc:'Average under 2 sec / answer in a 10+ card game',
    check:(s,r)=>r&&r.answerTimes&&r.answerTimes.length>=10&&(r.answerTimes.reduce((a,b)=>a+b,0)/r.answerTimes.length)<2000 },

  // ── Accuracy ──
  { id:'acc_10', cp:'1f3af', name:'Perfect Pitch', desc:'100% accuracy in a 10+ card game',  check:(s,r)=>r&&r.wrong===0&&r.correct>=10 },
  { id:'acc_25', cp:'1f3f9', name:'Bullseye',      desc:'100% accuracy in a 25+ card game',  check:(s,r)=>r&&r.wrong===0&&r.correct>=25 },
  { id:'acc_50', cp:'1f947', name:'Sharpshooter',  desc:'100% accuracy in a 50+ card game',  check:(s,r)=>r&&r.wrong===0&&r.correct>=50 },

  // ── Country completion ──
  { id:'cn_af',  cp:'1f981', name:'African Countries',        desc:'Identify every country in Africa',         check:s=>masteredComplete(s,'africa','country') },
  { id:'cn_as',  cp:'1f42f', name:'Asian Countries',          desc:'Identify every country in Asia',           check:s=>masteredComplete(s,'asia','country') },
  { id:'cn_eu',  cp:'1f3f0', name:'European Countries',       desc:'Identify every country in Europe',         check:s=>masteredComplete(s,'europe','country') },
  { id:'cn_na',  cp:'1f985', name:'North American Countries', desc:'Identify every country in North America',  check:s=>masteredComplete(s,'north-america','country') },
  { id:'cn_sa',  cp:'1f999', name:'South American Countries', desc:'Identify every country in South America',  check:s=>masteredComplete(s,'south-america','country') },
  { id:'cn_oc',  cp:'1f998', name:'Oceanian Countries',       desc:'Identify every country in Oceania',        check:s=>masteredComplete(s,'oceania','country') },
  { id:'cn_wd',  cp:'1f30d', name:'World Countries',          desc:'Identify every country worldwide',         check:s=>masteredComplete(s,'globe','country') },

  // ── Capital completion ──
  { id:'cp_af',  cp:'1f3ef', name:'African Capitals',         desc:'Identify every capital in Africa',         check:s=>masteredComplete(s,'africa','capital') },
  { id:'cp_as',  cp:'1f54c', name:'Asian Capitals',           desc:'Identify every capital in Asia',           check:s=>masteredComplete(s,'asia','capital') },
  { id:'cp_eu',  cp:'1f5fc', name:'European Capitals',        desc:'Identify every capital in Europe',         check:s=>masteredComplete(s,'europe','capital') },
  { id:'cp_na',  cp:'1f5fd', name:'North American Capitals',  desc:'Identify every capital in North America',  check:s=>masteredComplete(s,'north-america','capital') },
  { id:'cp_sa',  cp:'26ea',  name:'South American Capitals',  desc:'Identify every capital in South America',  check:s=>masteredComplete(s,'south-america','capital') },
  { id:'cp_oc',  cp:'1f6d6', name:'Oceanian Capitals',        desc:'Identify every capital in Oceania',        check:s=>masteredComplete(s,'oceania','capital') },
  { id:'cp_wd',  cp:'1f451', name:'World Capitals',           desc:'Identify every capital worldwide',         check:s=>masteredComplete(s,'globe','capital') },

  // ── Flag completion ──
  { id:'fl_af',  cp:'1f6a9', name:'African Flags',         desc:'Identify every flag in Africa',         check:s=>masteredComplete(s,'africa','flag') },
  { id:'fl_as',  cp:'1f38c', name:'Asian Flags',           desc:'Identify every flag in Asia',           check:s=>masteredComplete(s,'asia','flag') },
  { id:'fl_eu',  cp:'1f3c1', name:'European Flags',        desc:'Identify every flag in Europe',         check:s=>masteredComplete(s,'europe','flag') },
  { id:'fl_na',  cp:'1f3f4', name:'North American Flags',  desc:'Identify every flag in North America',  check:s=>masteredComplete(s,'north-america','flag') },
  { id:'fl_sa',  cp:'1f38f', name:'South American Flags',  desc:'Identify every flag in South America',  check:s=>masteredComplete(s,'south-america','flag') },
  { id:'fl_oc',  cp:'1fa81', name:'Oceanian Flags',        desc:'Identify every flag in Oceania',        check:s=>masteredComplete(s,'oceania','flag') },
  { id:'fl_wd',  cp:'1f310', name:'World Flags',           desc:'Identify every flag worldwide',         check:s=>masteredComplete(s,'globe','flag') },

  // ── Mountains ──
  { id:'mt_25',  cp:'1f5fb', name:'Mountain Man',    desc:'Identify 25 mountains',             check:s=>masteredCount(s,'mountain')>=25 },
  { id:'mt_t5',  cp:'1f9d7', name:'Sherpa',          desc:'Identify every tier 1–5 mountain',  check:s=>masteredComplete(s,'globe','mountain',5) },
  { id:'mt_all', cp:'1f30b', name:'Summit Ceremony', desc:'Identify every mountain in the game', check:s=>masteredComplete(s,'globe','mountain',13) },

  // ── Water ──
  { id:'wt_25',  cp:'1f30a', name:'Go With the Flow',desc:'Identify 25 rivers',               check:s=>masteredCount(s,'river')>=25 },
  { id:'wt_lk',  cp:'1f41f', name:'Lake Effect',     desc:'Identify every lake',              check:s=>masteredComplete(s,'globe','lake',13) },
  { id:'wt_sea', cp:'26f5',  name:'Sea Worthy',      desc:'Identify every sea',               check:s=>masteredComplete(s,'globe','sea',13) },
  { id:'wt_oc',  cp:'1f305', name:"Ocean's Eleven",  desc:'Identify every ocean',             check:s=>masteredComplete(s,'globe','ocean',13) },
  { id:'wt_str', cp:'1f6a4', name:'Strait Shooter',  desc:'Identify every strait',            check:s=>masteredComplete(s,'globe','strait',13) },

  // ── Landforms ──
  { id:'lf_isl', cp:'1f334', name:'Island Time',    desc:'Identify every major island', check:s=>masteredComplete(s,'globe','island',13) },
  { id:'lf_pen', cp:'1f5fe', name:'Out on a Limb',  desc:'Identify every peninsula',    check:s=>masteredComplete(s,'globe','peninsula',13) },
  { id:'lf_arc', cp:'1f5fa', name:'Archipela-Go',   desc:'Identify every archipelago',  check:s=>masteredComplete(s,'globe','archipelago',13) },

  // ── Cities & heritage ──
  { id:'ct_25',  cp:'1f306', name:'City Slicker',     desc:'Identify 25 cities',           check:s=>masteredCount(s,'city')>=25 },
  { id:'ct_all', cp:'1f303', name:'Urban Legend',     desc:'Identify every city',          check:s=>masteredComplete(s,'globe','city',13) },
  { id:'ct_her', cp:'1f3db', name:'World Wonder-er',  desc:'Identify every heritage site', check:s=>masteredComplete(s,'globe','heritage',13) },

  // ── Culture & trivia ──
  { id:'cu_tr',  cp:'1f9e0', name:'Trivia-l Pursuit', desc:'Answer 25 trivia questions',  check:s=>masteredCount(s,'trivia')>=25 },
  { id:'cu_lg',  cp:'1f4ac', name:'Polyglot',         desc:'Identify every language',     check:s=>masteredComplete(s,'globe','language',13) },

  // ── Recovery ──
  { id:'rc_10', cp:'1f501', name:'Second Chance', desc:'Correct 10 past mistakes', check:s=>(s.mistakesCorrected||0)>=10 },
  { id:'rc_50', cp:'1f4da', name:'Quick Study',   desc:'Correct 50 past mistakes', check:s=>(s.mistakesCorrected||0)>=50 },

  // ── Difficulty (Global Countries, 95%+) ──
  { id:'df_t5',  cp:'1f393', name:'Honor Roll',    desc:'Finish a Tier 5 World Countries game with 95%+ accuracy',  check:(s,r)=>diffBadgePass(r,5) },
  { id:'df_t9',  cp:'1f9ea', name:"Dean's List",   desc:'Finish a Tier 9 World Countries game with 95%+ accuracy',  check:(s,r)=>diffBadgePass(r,9) },
  { id:'df_t13', cp:'1f989', name:'Valedictorian', desc:'Finish a Tier 13 World Countries game with 95%+ accuracy', check:(s,r)=>diffBadgePass(r,13) },
];

if (typeof window !== 'undefined') {
  window.FLUENT3D_BASE = typeof FLUENT3D_BASE !== 'undefined' ? FLUENT3D_BASE : '/assets/badges/';
  window.ANIMAL_PRESERVE = typeof ANIMAL_PRESERVE !== 'undefined' ? ANIMAL_PRESERVE : [];
  window.BADGE_DEFS = typeof BADGE_DEFS !== 'undefined' ? BADGE_DEFS : [];
  window.animalImgHtml = typeof animalImgHtml !== 'undefined' ? animalImgHtml : null;
  window.badgeImgHtml = typeof badgeImgHtml !== 'undefined' ? badgeImgHtml : null;
}
