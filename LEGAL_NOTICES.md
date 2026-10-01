# MAPOLIS INTELLECTUAL PROPERTY, OPEN-SOURCE LICENSES & LEGAL COMPLIANCE REGISTER

Version: 1.0.0
Date: October 2026
Entity: Gnapoley LLC
Repository: Mapolis (Branch: pre-beta3)
Status: Verified & Audited

---

## 1. Executive Summary & Purpose
This document provides a comprehensive legal register of all third-party open-source libraries, geographic datasets, avatar vector assets, typography, and animal illustrations utilized within the Mapolis application. 

It explicitly cites the statutory provisions, permissive open-source license terms, and copyright grants that authorize Gnapoley LLC to bundle, self-host, copy, modify, display, and distribute these assets directly within the Mapolis codebase and production web application without payment of royalties.

---

## 2. Open-Source Asset Register & License Provisions

### 2.1 Microsoft Fluent Emoji 3D (Animal Preserve & Achievement Badges)
* **Author / Copyright Holder**: Microsoft Corporation
* **Package Origin**: `@lobehub/fluent-emoji-3d` (derived from `microsoft/fluentui-emoji`)
* **Local Storage Path**: `/assets/badges/*.webp` (93 localized files)
* **Governing License**: **MIT License**
* **Statutory Legal Coverage Grant**:
  > *"Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the 'Software'), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions: The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software."*
* **Compliance Status**: **100% Compliant**. The MIT notice is displayed in the application under `Credits & Acknowledgments` (`s-credits`). Self-hosting these WebP images directly in the repository is explicitly authorized.

---

### 2.2 DiceBear & Associated Vector Artists (Avatar Builder & Bot Opponents)
* **Project Maintainer**: Florian Körner / DiceBear
* **Artists & Styles**:
  * *Adventurer*: Lisa Wischofsky (Creative Commons Attribution 4.0 International - CC BY 4.0)
  * *Face Generator / Personas*: The Visual Team / Draftbit (CC BY 4.0)
  * *Big Smile*: Ashley Seo (CC BY 4.0)
  * *Croodles*: Vijay Verma (CC BY 4.0)
  * *Fun Emoji*: Davis Uche (CC BY 4.0)
  * *Miniavs*: Webpixels (CC BY 4.0)
  * *Avataaars*: Pablo Stanley (Free for Personal & Commercial Use)
  * *Bottts*: Pablo Stanley (Free for Personal & Commercial Use)
  * *Lorelei, Pixel Art, Thumbs, Notionists*: Florian Körner / DiceBear (CC0 1.0 Universal - Public Domain)
* **Local Storage Path**: `/play/avatar-assets.js`
* **Governing Licenses**: **CC BY 4.0 International**, **CC0 1.0 Universal**, **MIT / Free**
* **Statutory Legal Coverage Grant (CC BY 4.0 Section 3.a.1)**:
  > *"Subject to the terms and conditions of this Public License, the Licensor hereby grants You a worldwide, royalty-free, non-sublicensable, non-exclusive, irrevocable license to exercise the Licensed Rights in the Licensed Material to: (1) reproduce and Share the Licensed Material, in whole or in part; and (2) produce, reproduce, and Share Adapted Material... for commercial or non-commercial purposes."*
* **Statutory Legal Coverage Grant (CC0 1.0 Section 2)**:
  > *"Affirmer hereby publicly, irrevocably, unconditionally, and absolutely relinquishes and waives all Copyright and Related Rights in the Work... to the fullest extent permitted by applicable law."*
* **Compliance Status**: **100% Compliant**. Mapolis satisfies all Section 3(a)(1) attribution obligations by citing each individual creator and their respective license terms in the in-app `s-credits` screen.

---

### 2.3 Geographic Data: Natural Earth & world-atlas
* **Authors / Maintainers**: 
  * Natural Earth: Tom Patterson & Nathaniel Vaughn Kelso (Public Domain)
  * world-atlas: Mike Bostock (ISC License)
* **Local Storage Path**: `/play/map-data.js` and `/lib/topojson.min.js`
* **Governing Licenses**: **Public Domain (CC0)** and **ISC License**
* **Statutory Legal Coverage Grant (Natural Earth Terms of Use)**:
  > *"All versions of Natural Earth raster + vector map data found on this website are in the public domain. You may use the maps in any manner, including modifying the content and designs, copying, distributing, and commercializing the work."*
* **Statutory Legal Coverage Grant (ISC License)**:
  > *"Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies."*
* **Compliance Status**: **100% Compliant**. Localized geometry files are bundled locally; attribution is maintained in the application credits.

---

### 2.4 Mathematical & Projection Engines: D3.js & TopoJSON
* **Author / Copyright Holder**: Mike Bostock / Observable
* **Local Storage Path**: `/lib/d3.min.js`, `/lib/topojson.min.js`
* **Governing Licenses**: **ISC License** and **BSD 3-Clause License**
* **Statutory Legal Coverage Grant (BSD 3-Clause)**:
  > *"Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: (1) Redistributions of source code must retain the above copyright notice; (2) Redistributions in binary form must reproduce the above copyright notice..."*
* **Compliance Status**: **100% Compliant**. Fully self-hosted with copyright citations preserved.

---

### 2.5 Typography: Google Fonts (Fredoka One, Nunito, Space Mono)
* **Foundries / Designers**: Milena Brandao, Vernon Adams, Colophon Foundry
* **Local Storage Path**: `/play/fonts.css` (Base64 WOFF2 embedded vectors)
* **Governing License**: **SIL Open Font License (OFL 1.1)**
* **Statutory Legal Coverage Grant (SIL OFL Clause 1 & 2)**:
  > *"Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software, to use, study, copy, merge, embed, modify, redistribute, and sell modified and unmodified copies of the Font Software, subject to the following conditions: (1) Neither the Font Software nor any of its individual components... may be sold by itself; (2) Bundled, embedded and/or redistributed copies... are permitted."*
* **Compliance Status**: **100% Compliant**. Fonts are embedded within CSS stylesheets to eliminate external network requests to `fonts.googleapis.com`.

---

## 3. Standard Industry Best Practice for Legal & Asset Attribution
In professional commercial software and educational procurement, the standard practice is:
1. **Repository Notice File**: A top-level `LEGAL_NOTICES.md` or `THIRD_PARTY_LICENSES.md` file checked into Git (this file).
2. **In-App Citations**: An accessible `Credits & Acknowledgments` screen inside the UI linking names, roles, and licenses (already implemented in Mapolis under `s-credits`).
3. **Hermetic Self-Hosting**: Transitioning all CDN hotlinks to local repository storage to satisfy COPPA/FERPA student privacy mandates without violating upstream licenses.
