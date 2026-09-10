document.addEventListener('DOMContentLoaded', async () => {
    const reviewerUsername = document.getElementById('reviewer-username');
    const requestsTbody = document.getElementById('requests-tbody');
    const logoutBtn = document.getElementById('logout-btn');

    // Fetch dashboard data
    // Assume backend is on the same port when testing locally or target railway dynamically
    const BACKEND_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
        ? 'http://localhost:3000'
        : 'https://steelmountain-backend-production.up.railway.app';

    try {
        // Send request including credentials (cookies)
        const response = await fetch(`${BACKEND_URL}/api/website-a/dashboard`, {
            method: 'GET',
            credentials: 'include'
        });

        if (!response.ok) {
            // Unauthorized or expired session, redirect to login
            window.location.href = 'login.html';
            return;
        }

        const data = await response.json();
        
        // Render data
        reviewerUsername.textContent = data.reviewer_name;

        // Render decorative divider (morse code)
        const themePattern = data.theme_pattern;
        if (themePattern) {
            const separator = document.getElementById('content-separator');
            let html = '';
            for (const char of themePattern) {
                if (char === '.') html += '<span class="cs-a"></span>';
                else if (char === '-') html += '<span class="cs-b"></span>';
                else if (char === ' ') html += '<span class="cs-gap"></span>';
                else if (char === '/') html += '<span class="cs-word-gap"></span>';
            }
            separator.innerHTML = html;
        }

        // Render mock pending requests
        if (data.pending_requests && data.pending_requests.length > 0) {
            requestsTbody.innerHTML = '';
            data.pending_requests.forEach(req => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${req.id}</td>
                    <td>${req.target_username}</td>
                    <td><span class="status-badge status-${req.status}">${req.status.replace('_', ' ').toUpperCase()}</span></td>
                    <td>${req.created_at}</td>
                    <td><button class="btn btn-secondary" style="padding: 2px 8px; font-size: 10px;" disabled>Review</button></td>
                `;
                requestsTbody.appendChild(tr);
            });
        } else {
            requestsTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #666666;">No active workflows.</td></tr>`;
        }

    } catch (error) {
        console.error('Error fetching dashboard:', error);
        requestsTbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #990000;">Failed to load console data. Please contact IT support.</td></tr>`;
    }

    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        // Clear cookie by setting it to past date (note: cross-site httpOnly cookie cannot be deleted via JS directly,
        // but we can redirect or let the session clear. Let's redirect to login.html).
        window.location.href = 'login.html';
    });
});
