const API_BASE = "http://localhost:5000"; // change after deployment

function getToken() {
  return localStorage.getItem("token");
}

async function apiRequest(path, method = "GET", data = null) {
  const options = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: getToken() ? `Bearer ${getToken()}` : ""
    }
  };

  if (data) options.body = JSON.stringify(data);

  const res = await fetch(`${API_BASE}${path}`, options);
  return res.json();
}
