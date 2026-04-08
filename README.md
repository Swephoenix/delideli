# Beställningsportal

Komplett system för att hantera förfrågningar och uppdrag med inloggning, rollbaserad åtkomst och persistent databas.

## Struktur

```
mobilapp/
├── server/
│   ├── server.js           # Backend: auth, sessioner, RBAC, filhantering
│   ├── database.js         # JSON-databas med 5 tabeller
│   └── data/               # Persistent data (skapas automatiskt)
│       ├── users.json
│       ├── assignments.json
│       ├── notes.json
│       ├── sessions.json
│       ├── login_logs.json
│       └── seeded
├── assignments/
│   ├── index.html          # Startsidan
│   └── assignments.html    # Användare skapar ärenden (öppet)
├── manager/
│   └── manager.html        # Manager Dashboard (James)
├── worker/
│   └── worker.html         # Arbetarpanel (Sara/Erik/Linda)
└── man.png, women.png      # Avatarbilder
```

## Kom igång

```bash
cd server
node server.js
```

Servern startar på **http://127.0.0.1:8092**

## Testkonton

| Roll | E-post | Lösenord |
|------|--------|----------|
| Manager | jm@x.se | jm1 |
| Arbetare | sa@x.se | sa1 |
| Arbetare | er@x.se | er1 |
| Arbetare | li@x.se | li1 |

## Flöde

1. **Användare** skapar ärende via `/assignments` (ingen inloggning)
2. **Manager** (James) loggar in → ser alla ärenden → får AI-förslag → tilldelar arbetare → status blir "Väntar på svar"
3. **Arbetare** (t.ex. Sara) loggar in → ser **endast** sina uppdrag → **accepterar eller avböjer**
   - **Accepterar** → status blir "Accepterad" → kan lägga till anteckningar → markera som klar
   - **Avböjer** → anger anledning → uppdrag flyttas till arkiv
4. **Manager** kan när som helst:
   - **Redigera** beskrivning, ämne och bifoga filer
   - **Skicka uppdatering** till arbetaren (återställer till "Väntar på svar")
   - **Omtilldela** till annan arbetare
   - **Ta bort** uppdrag helt
   - **Se inloggningslogg** för varje arbetare

## Funktioner

### Manager
| Funktion | Beskrivning |
|----------|-------------|
| ✏️ Redigera innehåll | Ändra ämne, beskrivning och bifoga filer till ett uppdrag |
| 📤 Skicka uppdatering | Uppdatera uppdraget och skicka vidare till arbetaren (återställer till pending) |
| 🔄 Omtilldela | Tilldela uppdraget till en annan arbetare |
| 🗑️ Ta bort | Radera uppdrag permanent (inklusive anteckningar) |
| 👥 Teamvy | Se alla arbetare med aktuella uppdrag och senaste inloggning |
| 📋 Inloggningslogg | Klicka på en arbetare för att se historik över alla inloggningar |
| 💬 Anteckningar | Lägg till kommentarer på varje uppdrag |

### Arbetare
| Funktion | Beskrivning |
|----------|-------------|
| ✅ Acceptera | Godkänn ett tilldelat uppdrag |
| ❌ Avböj | Avvisa med anledning |
| 📝 Anteckningar | Dokumentera arbete |
| ✔️ Markera klar | Slutför uppdraget |
| 🔒 Sekretess | Ser endast sina egna uppdrag |

## Åtkomstregler

- **Manager** ser alla ärenden, kan redigera, tilldela, ta bort
- **Arbetare** ser endast ärenden tilldelade till dem
- Arbetare kan inte se andras uppdrag
- Endast manager kan ta bort ärenden

## API

| Metod | Sökväg | Auth | Roll | Beskrivning |
|---|---|---|---|---|
| `POST` | `/api/login` | Nej | — | Logga in |
| `POST` | `/api/logout` | Ja | — | Logga ut |
| `GET` | `/api/me` | Ja | — | Hämta inloggad användare |
| `POST` | `/api/assignments` | Nej | — | Skapa ärende |
| `GET` | `/api/assignments` | Ja | — | Hämta ärenden (filtrerat per roll) |
| `GET` | `/api/assignments/:id` | Ja | — | Hämta ett ärende |
| `POST` | `/api/assignments/:id/assign` | Ja | manager | Tilldela till arbetare |
| `POST` | `/api/assignments/:id/accept` | Ja | worker | Acceptera uppdrag |
| `POST` | `/api/assignments/:id/decline` | Ja | worker | Avböj uppdrag |
| `POST` | `/api/assignments/:id/edit-content` | Ja | manager | Redigera ämne, beskrivning, filer |
| `PATCH` | `/api/assignments/:id` | Ja | — | Uppdatera anteckningar/status |
| `DELETE` | `/api/assignments/:id` | Ja | manager | Ta bort uppdrag |
| `GET/POST` | `/api/assignments/:id/notes` | Ja | — | Hämta/lägg till anteckningar |
| `GET` | `/api/assignments/:id/ai-suggestion` | Ja | — | Hämta AI-förslag |
| `GET` | `/api/team` | Ja | manager | Hämta teamöversikt med login-tider |
| `GET` | `/api/workers` | Ja | manager | Hämta lista över arbetare |
| `GET` | `/api/workers/:id/login-logs` | Ja | manager | Hämta inloggningslogg för arbetare |

## Databas

All data sparas persistent i `server/data/` som JSON-filer:

| Tabell | Innehåll |
|--------|----------|
| `users` | Konton med lösenord (SHA-256), roll, senaste inloggning |
| `assignments` | Alla ärenden med status, tilldelning, filer, svar |
| `notes` | Anteckningar kopplade till ärenden |
| `sessions` | Aktiva inloggningssessioner (24h TTL) |
| `login_logs` | Historik över alla inloggningar |

För att återställa databasen: ta bort `server/data/`-mappen och starta om servern.
