const { JSDOM } = require('jsdom');
const fs = require('fs');
const html = fs.readFileSync('play/index.html', 'utf-8');

const dom = new JSDOM(html, { 
  runScripts: "dangerously", 
  url: "http://localhost:3000/play/index.html" 
});
const window = dom.window;

// Polyfill minimal supabase
window.supabase = {
  createClient: () => ({})
};
window.d3 = {
  geoOrthographic: () => ({
    scale: () => ({
      translate: () => ({
        clipAngle: () => ({})
      })
    })
  }),
  geoPath: () => (() => {}),
  select: () => ({
    append: () => ({
      attr: () => ({
        attr: () => ({
          attr: () => ({
            attr: () => ({
              attr: () => ({})
            })
          })
        })
      })
    })
  })
};
window.topojson = {};

window.addEventListener("error", (event) => {
  console.log("Error:", event.error ? event.error.message : event.message);
});
setTimeout(() => {
  console.log("Done waiting");
}, 2000);
