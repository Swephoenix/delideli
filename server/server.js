const http = require('http');
const fs = require('fs');
const path = require('path');
const db = require('./database');

const PORT = 8092;
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_COOKIES = {
  default: 'session',
  manager: 'manager_session',
  worker: 'worker_session',
};
const AI_BOT = {
  id: 'ai-bot',
  name: 'Deligator AI',
  gender: 'man',
  is_ai: true,
};

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const ROUTES = {
  '/': { folder: '', file: 'flow.html' },
  '/flow': { folder: '', file: 'flow.html' },
  '/assignments': { folder: 'assignments', file: 'assignments.html' },
  '/manager': { folder: 'manager', file: 'manager.html' },
  '/worker': { folder: 'worker', file: 'worker.html' },
};

// ── Auth helpers ────────────────────────────────────────────────────
function parseCookies(req) {
  const cookieHeader = req.headers.cookie || '';
  return cookieHeader.split(';').reduce((cookies, part) => {
    const [rawName, ...rest] = part.trim().split('=');
    if (!rawName) return cookies;
    cookies[rawName] = rest.join('=');
    return cookies;
  }, {});
}

function getSessionCookieName(req) {
  const app = (req.headers['x-app'] || '').toLowerCase();
  return SESSION_COOKIES[app] || SESSION_COOKIES.default;
}

function getSessionToken(req) {
  const cookies = parseCookies(req);
  const cookieName = getSessionCookieName(req);
  return cookies[cookieName] || null;
}

function getSession(req) {
  const token = getSessionToken(req);
  if (!token) return null;
  const sessions = db.readTable('sessions');
  const session = sessions.find(s => s.token === token && Date.now() - s.created_at < SESSION_TTL);
  if (!session) return null;
  const users = db.readTable('users');
  return users.find(u => u.id === session.user_id) || null;
}

function setSessionCookie(req, res, token) {
  const cookieName = getSessionCookieName(req);
  res.setHeader('Set-Cookie', `${cookieName}=${token}; Path=/; HttpOnly; Max-Age=${SESSION_TTL / 1000}`);
}

function clearSessionCookie(req, res) {
  const cookieName = getSessionCookieName(req);
  res.setHeader('Set-Cookie', [
    `${cookieName}=; Path=/; HttpOnly; Max-Age=0`,
    `${SESSION_COOKIES.default}=; Path=/; HttpOnly; Max-Age=0`,
  ]);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function isAiWorker(name) {
  return name === AI_BOT.name;
}

// ── Static file serving ────────────────────────────────────────────
function serveFile(res, folder, filename) {
  const filePath = path.join(__dirname, '..', folder, filename);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filename);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    res.end(data);
  });
}

function serveRootFile(res, filename) {
  const filePath = path.join(__dirname, '..', filename);
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filename);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'text/plain' });
    res.end(data);
  });
}

// ── Server ──────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // ── API: Login ──────────────────────────────────────────────────
  if (pathname === '/api/login' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const users = db.readTable('users');
      const user = users.find(u => u.email === body.email && u.password === db.hashPassword(body.password));
      if (!user) {
        return json(res, 401, { error: 'Fel e-post eller lösenord' });
      }

      // Record login
      user.last_login = new Date().toISOString();
      db.writeTable('users', users);

      const loginLogs = db.readTable('login_logs');
      loginLogs.push({
        user_id: user.id,
        user_name: user.name,
        login_at: user.last_login,
      });
      db.writeTable('login_logs', loginLogs);

      const token = db.generateToken();
      const sessions = db.readTable('sessions');
      sessions.push({ token, user_id: user.id, created_at: Date.now() });
      db.writeTable('sessions', sessions);
      setSessionCookie(req, res, token);
      return json(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role, gender: user.gender, last_login: user.last_login } });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ── API: Logout ─────────────────────────────────────────────────
  if (pathname === '/api/logout' && req.method === 'POST') {
    const session = getSession(req);
    if (session) {
      let sessions = db.readTable('sessions');
      const token = getSessionToken(req);
      if (token) {
        sessions = sessions.filter(s => s.token !== token);
        db.writeTable('sessions', sessions);
      }
    }
    clearSessionCookie(req, res);
    return json(res, 200, { ok: true });
  }

  // ── API: Current user ───────────────────────────────────────────
  if (pathname === '/api/me' && req.method === 'GET') {
    const user = getSession(req);
    if (!user) {
      return json(res, 401, { error: 'Not authenticated' });
    }
    return json(res, 200, { user: { id: user.id, name: user.name, email: user.email, role: user.role, gender: user.gender } });
  }

  // ── API: Submit new assignment (public) ─────────────────────────
  if (pathname === '/api/assignments' && req.method === 'POST') {
    try {
      const body = await parseBody(req);
      const assignments = db.readTable('assignments');
      const assignment = {
        id: db.nextId('assignments'),
        category: body.category || '',
        name: body.name || '',
        email: body.email || '',
        phone: body.phone || '',
        subject: body.subject || '',
        message: body.message || '',
        status: 'new',
        assigned_to: null,
        response_status: null,
        completed_at: null,
        completed_by: null,
        declined_at: null,
        declined_reason: '',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      assignments.push(assignment);
      db.writeTable('assignments', assignments);
      return json(res, 201, assignment);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ── API: Get assignments (role-filtered) ────────────────────────
  if (pathname === '/api/assignments' && req.method === 'GET') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });

    let assignments = db.readTable('assignments');

    if (user.role === 'worker') {
      // Workers see: tasks assigned to them (pending or accepted) + tasks they completed
      assignments = assignments.filter(a => a.assigned_to === user.name || (a.status === 'done' && a.completed_by === user.name));
    }
    // Managers see all assignments

    return json(res, 200, assignments.sort((a, b) => b.id - a.id));
  }

  // ── API: Get single assignment ──────────────────────────────────
  if (pathname.match(/^\/api\/assignments\/\d+$/) && req.method === 'GET') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });

    const id = parseInt(pathname.split('/').pop());
    const assignments = db.readTable('assignments');
    const assignment = assignments.find(a => a.id === id);
    if (!assignment) return json(res, 404, { error: 'Not found' });

    // Workers can only view their own assignments (including pending)
    if (user.role === 'worker' && assignment.assigned_to !== user.name && !(assignment.status === 'done' && assignment.completed_by === user.name)) {
      return json(res, 403, { error: 'Access denied' });
    }

    return json(res, 200, assignment);
  }

  // ── API: Assign task ────────────────────────────────────────────
  if (pathname.match(/^\/api\/assignments\/\d+\/assign$/) && req.method === 'POST') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });
    if (user.role !== 'manager') return json(res, 403, { error: 'Only managers can assign tasks' });

    try {
      const id = parseInt(pathname.split('/')[3]);
      const body = await parseBody(req);
      const assignments = db.readTable('assignments');
      const assignment = assignments.find(a => a.id === id);
      if (!assignment) return json(res, 404, { error: 'Not found' });

      assignment.assigned_to = body.worker || null;
      if (isAiWorker(body.worker)) {
        assignment.status = 'assigned';
        assignment.response_status = 'accepted';
      } else {
        assignment.status = 'pending';
        assignment.response_status = null;
      }
      assignment.updated_at = new Date().toISOString();
      db.writeTable('assignments', assignments);

      if (isAiWorker(body.worker)) {
        const notes = db.readTable('notes');
        notes.push({
          id: db.nextId('notes'),
          assignment_id: id,
          user_id: 0,
          user_name: AI_BOT.name,
          content: 'AI-boten har accepterat uppdraget och är redo att ta fram ett första förslag.',
          created_at: new Date().toISOString(),
        });
        db.writeTable('notes', notes);
      }

      return json(res, 200, assignment);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ── API: Accept assignment ───────────────────────────────────────
  if (pathname.match(/^\/api\/assignments\/\d+\/accept$/) && req.method === 'POST') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });
    if (user.role !== 'worker') return json(res, 403, { error: 'Only workers can respond' });

    try {
      const id = parseInt(pathname.split('/')[3]);
      const assignments = db.readTable('assignments');
      const assignment = assignments.find(a => a.id === id);
      if (!assignment) return json(res, 404, { error: 'Not found' });
      if (assignment.assigned_to !== user.name) return json(res, 403, { error: 'Access denied' });

      assignment.status = 'assigned';
      assignment.response_status = 'accepted';
      assignment.updated_at = new Date().toISOString();
      db.writeTable('assignments', assignments);
      return json(res, 200, assignment);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ── API: Decline assignment ──────────────────────────────────────
  if (pathname.match(/^\/api\/assignments\/\d+\/decline$/) && req.method === 'POST') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });
    if (user.role !== 'worker') return json(res, 403, { error: 'Only workers can respond' });

    try {
      const id = parseInt(pathname.split('/')[3]);
      const body = await parseBody(req);
      const assignments = db.readTable('assignments');
      const assignment = assignments.find(a => a.id === id);
      if (!assignment) return json(res, 404, { error: 'Not found' });
      if (assignment.assigned_to !== user.name) return json(res, 403, { error: 'Access denied' });

      assignment.status = 'declined';
      assignment.response_status = 'declined';
      assignment.declined_at = new Date().toISOString();
      assignment.declined_reason = body.reason || '';
      assignment.updated_at = new Date().toISOString();
      db.writeTable('assignments', assignments);
      return json(res, 200, assignment);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ── API: Delete assignment (manager only) ───────────────────────
  if (pathname.match(/^\/api\/assignments\/\d+$/) && req.method === 'DELETE') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });
    if (user.role !== 'manager') return json(res, 403, { error: 'Only managers can delete assignments' });

    try {
      const id = parseInt(pathname.split('/')[3]);
      let assignments = db.readTable('assignments');
      const idx = assignments.findIndex(a => a.id === id);
      if (idx === -1) return json(res, 404, { error: 'Not found' });
      assignments.splice(idx, 1);
      db.writeTable('assignments', assignments);

      // Also delete related notes
      let notes = db.readTable('notes');
      notes = notes.filter(n => n.assignment_id !== id);
      db.writeTable('notes', notes);

      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ── API: Manager edit assignment content ────────────────────────
  if (pathname.match(/^\/api\/assignments\/\d+\/edit-content$/) && req.method === 'POST') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });
    if (user.role !== 'manager') return json(res, 403, { error: 'Only managers can edit assignments' });

    try {
      const id = parseInt(pathname.split('/')[3]);
      const body = await parseBody(req);
      const assignments = db.readTable('assignments');
      const assignment = assignments.find(a => a.id === id);
      if (!assignment) return json(res, 404, { error: 'Not found' });

      if (body.subject !== undefined) assignment.subject = body.subject;
      if (body.message !== undefined) assignment.message = body.message;
      if (body.category !== undefined) assignment.category = body.category;
      if (body.attachments !== undefined) assignment.attachments = body.attachments;
      assignment.updated_at = new Date().toISOString();

      // If reassigned, reset response status
      if (body.assigned_to !== undefined) {
        assignment.assigned_to = body.assigned_to;
        if (isAiWorker(body.assigned_to)) {
          assignment.status = 'assigned';
          assignment.response_status = 'accepted';
        } else if (body.assigned_to && assignment.status !== 'declined') {
          assignment.status = 'pending';
          assignment.response_status = null;
        }
      }

      db.writeTable('assignments', assignments);
      return json(res, 200, assignment);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ── API: Get login logs for a worker (manager only) ─────────────
  if (pathname.match(/^\/api\/workers\/\d+\/login-logs$/) && req.method === 'GET') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });
    if (user.role !== 'manager') return json(res, 403, { error: 'Only managers can view login logs' });

    try {
      const workerId = parseInt(pathname.split('/')[3]);
      const users = db.readTable('users');
      const worker = users.find(u => u.id === workerId);
      if (!worker) return json(res, 404, { error: 'Worker not found' });

      const loginLogs = db.readTable('login_logs').filter(l => l.user_id === workerId);
      return json(res, 200, {
        worker: { id: worker.id, name: worker.name, email: worker.email, gender: worker.gender, last_login: worker.last_login },
        logs: loginLogs.sort((a, b) => new Date(b.login_at) - new Date(a.login_at)),
      });
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ── API: Update assignment (notes, status) ──────────────────────
  if (pathname.match(/^\/api\/assignments\/\d+$/) && req.method === 'PATCH') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });

    try {
      const id = parseInt(pathname.split('/')[3]);
      const body = await parseBody(req);
      const assignments = db.readTable('assignments');
      const assignment = assignments.find(a => a.id === id);
      if (!assignment) return json(res, 404, { error: 'Not found' });

      // Workers can only update their own assignments (including pending)
      if (user.role === 'worker' && assignment.assigned_to !== user.name) {
        return json(res, 403, { error: 'Access denied' });
      }

      if (body.notes !== undefined) assignment.notes = body.notes;
      if (body.status !== undefined) {
        assignment.status = body.status;
        if (body.status === 'done') {
          assignment.completed_by = user.name;
          assignment.completed_at = new Date().toISOString();
        }
      }
      assignment.updated_at = new Date().toISOString();
      db.writeTable('assignments', assignments);
      return json(res, 200, assignment);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ── API: Get notes for an assignment ────────────────────────────
  if (pathname.match(/^\/api\/assignments\/\d+\/notes$/) && req.method === 'GET') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });

    const id = parseInt(pathname.split('/')[3]);
    const notes = db.readTable('notes').filter(n => n.assignment_id === id);
    return json(res, 200, notes);
  }

  // ── API: Add note ───────────────────────────────────────────────
  if (pathname.match(/^\/api\/assignments\/\d+\/notes$/) && req.method === 'POST') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });

    try {
      const id = parseInt(pathname.split('/')[3]);
      const body = await parseBody(req);
      const assignments = db.readTable('assignments');
      const assignment = assignments.find(a => a.id === id);
      if (!assignment) return json(res, 404, { error: 'Not found' });

      // Only the assigned worker or manager can add notes
      if (user.role === 'worker' && assignment.assigned_to !== user.name) {
        return json(res, 403, { error: 'Access denied' });
      }

      const notes = db.readTable('notes');
      notes.push({
        id: db.nextId('notes'),
        assignment_id: id,
        user_id: user.id,
        user_name: user.name,
        content: body.content || '',
        created_at: new Date().toISOString(),
      });
      db.writeTable('notes', notes);
      return json(res, 201, notes[notes.length - 1]);
    } catch (e) {
      return json(res, 400, { error: e.message });
    }
  }

  // ── API: Get team (manager only) ────────────────────────────────
  if (pathname === '/api/team' && req.method === 'GET') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });
    if (user.role !== 'manager') return json(res, 403, { error: 'Only managers can view team' });

    const workers = db.readTable('users').filter(u => u.role === 'worker');
    const assignments = db.readTable('assignments');
    const team = workers.map(w => ({
      id: w.id,
      name: w.name,
      gender: w.gender,
      last_login: w.last_login,
      tasks: assignments.filter(a => a.assigned_to === w.name && a.status !== 'done' && a.status !== 'declined'),
    }));
    return json(res, 200, team);
  }

  // ── API: Get all workers (manager only) ─────────────────────────
  if (pathname === '/api/workers' && req.method === 'GET') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });
    if (user.role !== 'manager') return json(res, 403, { error: 'Only managers can view workers' });

    const workers = db.readTable('users')
      .filter(u => u.role === 'worker')
      .map(w => ({ id: w.id, name: w.name, gender: w.gender }));
    return json(res, 200, [...workers, AI_BOT]);
  }

  // ── API: AI suggestion (placeholder) ────────────────────────────
  if (pathname.match(/^\/api\/assignments\/\d+\/ai-suggestion$/) && req.method === 'GET') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });

    const id = parseInt(pathname.split('/')[3]);
    const assignments = db.readTable('assignments');
    const assignment = assignments.find(a => a.id === id);
    if (!assignment) return json(res, 404, { error: 'Not found' });

    const suggestions = {
      'Videoskapande eller redigering': 'Föreslår: Sara (Expert på Premiere) eller Erik (Ledig nu).',
      'IT-frågor': 'Föreslår: Erik (Systemansvarig) eller Linda (IT-support).',
      'Beställa broschyrer': 'Föreslår: Linda (Grafisk producent) eller Sara (Trycksamordnare).',
      'Frågor som gäller partiet': 'Föreslår: Sara (Kommunikationsansvarig) eller Erik (Organisatör).',
      'Nya bilder och grafik': 'Föreslår: Linda (Grafisk designer) eller Sara (Fotograf).',
    };
    return json(res, 200, {
      suggestion: suggestions[assignment.category] || 'Föreslår: Tilldela en ledig medarbetare eller Deligator AI.',
      aiNote: 'AI-förslag baserat på kategori och tillgänglighet.',
    });
  }

  // ── API: AI work instructions (placeholder) ─────────────────────
  if (pathname.match(/^\/api\/assignments\/\d+\/ai-instructions$/) && req.method === 'GET') {
    const user = getSession(req);
    if (!user) return json(res, 401, { error: 'Not authenticated' });

    const id = parseInt(pathname.split('/')[3]);
    const assignments = db.readTable('assignments');
    const assignment = assignments.find(a => a.id === id);
    if (!assignment) return json(res, 404, { error: 'Not found' });
    if (user.role === 'worker' && assignment.assigned_to !== user.name) {
      return json(res, 403, { error: 'Access denied' });
    }

    const category = assignment.category || 'uppgiften';
    const title = assignment.subject || category;
    const instructions = [
      `Läs igenom uppdraget "${title}" och identifiera exakt vad som ska levereras.`,
      `Sammanfatta kundens behov i 2-3 punkter och kontrollera om något saknas i beskrivningen.`,
      `Bryt ner arbetet i delmoment och börja med det som blockerar resten av leveransen.`,
      `Utför arbetet stegvis och dokumentera viktiga beslut i anteckningarna för uppdraget.`,
      `Verifiera att resultatet matchar kategori "${category}" och att inget krav har missats.`,
      `Skriv en kort slutnotering om vad som är gjort och markera sedan uppdraget som klart.`,
    ];

    if (assignment.attachments && assignment.attachments.length > 0) {
      instructions.splice(1, 0, 'Gå igenom bifogade filer först och använd dem som underlag innan du börjar producera något nytt.');
    }

    if (assignment.message) {
      instructions.splice(2, 0, `Utgå särskilt från beställarens beskrivning: "${assignment.message.slice(0, 140)}${assignment.message.length > 140 ? '...' : ''}"`);
    }

    return json(res, 200, {
      title: `AI-steg för ${title}`,
      instructions,
      disclaimer: 'Detta är ett AI-genererat arbetsförslag. Anpassa stegen efter verkligt behov.',
    });
  }

  // ── Static file serving ─────────────────────────────────────────
  const appFolders = ['assignments', 'manager', 'worker'];
  for (const folder of appFolders) {
    if (pathname.startsWith('/' + folder + '/')) {
      const filename = pathname.slice(folder.length + 2);
      return serveFile(res, folder, filename);
    }
  }

  // Serve images from root mobilapp folder
  if (pathname.match(/\.(png|jpg|svg|ico|gif)$/)) {
    return serveRootFile(res, pathname.slice(1));
  }

  // Route to app
  const route = ROUTES[pathname] || ROUTES['/'];
  if (route) {
    return serveFile(res, route.folder, route.file);
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`\n🚀 Beställningsportal running at http://127.0.0.1:${PORT}`);
  console.log(`\n📋 Routes:`);
  console.log(`   http://127.0.0.1:${PORT}/          → Landing page`);
  console.log(`   http://127.0.0.1:${PORT}/assignments → User submission`);
  console.log(`   http://127.0.0.1:${PORT}/manager    → Manager Dashboard (James)`);
  console.log(`   http://127.0.0.1:${PORT}/worker     → Worker Panel (Sara)`);
  console.log(`\n🔑 Test accounts:`);
  console.log(`   Manager: jm@x.se / jm1`);
  console.log(`   Worker:  sa@x.se / sa1`);
  console.log(`   Worker:  er@x.se / er1`);
  console.log(`   Worker:  li@x.se / li1`);
});
