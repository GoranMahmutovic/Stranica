# Veslacki dnevnik treninga

Javna stranica za analizu CSV datoteka iz NK SpeedCoach 2 uredaja.

Stranica ima dva nacina rada:

- javni link za trenera i sve gledatelje: samo pregled treninga
- admin link za vlasnika dnevnika: pregled + dodavanje novih CSV treninga

Nema korisnickih racuna i nema prijave unutar stranice. Admin pristup radi preko tajnog upload kljuca u linku.

## Kako radi spremanje podataka

Kada vlasnik dnevnika doda CSV kroz admin link:

1. browser analizira CSV i prikaze trening
2. CSV se spremi lokalno u browser kao rezervna kopija
3. CSV se posalje na Netlify Function endpoint `/api/sessions`
4. Netlify Function provjeri tajni `UPLOAD_KEY`
5. sirovi CSV se spremi u Netlify Blobs pod `csv/<id>.csv`
6. popis treninga se spremi u Netlify Blobs kao `index.json`

Trener otvara obican javni link. Stranica tada cita sve javno spremljene treninge iz `/api/sessions` i sama u browseru crta grafove, tablice, intervale i sazetke.

## Linkovi

Primjeri nakon deploya:

- javni link za trenera: `https://tvoja-stranica.netlify.app/`
- admin link za upload: `https://tvoja-stranica.netlify.app/?uploadKey=TAJNI_KLJUC`
- gasenje admin nacina na uredaju: `https://tvoja-stranica.netlify.app/?admin=off`

Kada otvoris admin link, stranica spremi upload kljuc u tvoj browser i makne ga iz adresne trake. Tako je manja sansa da treneru slucajno posaljes admin link.

## Netlify postavljanje

1. Otvori Netlify racun.
2. Objavi ovaj projekt na GitHub ili ga povezi s Netlifyjem na drugi nacin koji podrzava Functions.
3. U Netlifyju napravi novi site iz tog projekta.
4. Netlify treba koristiti `netlify.toml` iz projekta:
   - publish directory: `.`
   - functions directory: `netlify/functions`
   - API redirect: `/api/sessions`
5. U Netlify dashboardu dodaj environment variable:
   - key: `UPLOAD_KEY`
   - value: dugi tajni tekst, npr. `gm-veslanje-2026-dugi-tajni-kljuc`
6. Deployaj site.
7. Testiraj javni link bez `uploadKey`: upload gumb ne smije biti vidljiv.
8. Testiraj admin link s `?uploadKey=...`: upload gumb mora biti vidljiv.

## Vlastita domena

Za adresu `www.gmveslanje.com` kupuje se domena `gmveslanje.com`. Dio `www` nije posebna domena, nego DNS zapis.

Koraci:

1. Kod registrara provjeri je li `gmveslanje.com` slobodna.
2. Ako je slobodna, kupi je na godinu dana.
3. U Netlifyju otvori site settings i dodaj custom domain:
   - `gmveslanje.com`
   - `www.gmveslanje.com`
4. Netlify ce pokazati koje DNS zapise treba postaviti kod registrara.
5. Najcesce:
   - `www` ide kao `CNAME` na Netlify adresu
   - root domena `gmveslanje.com` ide preko Netlify DNS-a ili zapisa koje Netlify prikaze
6. Pricekaj DNS propagaciju. Obicno traje od nekoliko minuta do par sati.
7. Netlify ce automatski ukljuciti HTTPS certifikat.

Nakon toga:

- treneru saljes `https://www.gmveslanje.com/`
- sebi za upload otvoris `https://www.gmveslanje.com/?uploadKey=TAJNI_KLJUC`

## Privatnost

Stranica nema prijavu. To znaci:

- svi koji imaju javni link mogu citati objavljene treninge
- samo osoba s admin linkom i ispravnim `UPLOAD_KEY` moze dodavati CSV
- ako admin link procuri, promijeni `UPLOAD_KEY` u Netlify environment variables i ponovno deployaj

## Lokalno pokretanje

Za obican lokalni pregled statickih datoteka:

```powershell
python -m http.server 5173
```

Otvori:

```text
http://localhost:5173
```

Za testiranje Netlify Functions lokalno potreban je Node.js i Netlify CLI:

```powershell
npm install
npm run dev
```

U ovom slucaju lokalni API radi preko Netlify Dev servera.
