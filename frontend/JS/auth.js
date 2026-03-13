async function registerUser(e) {
  e.preventDefault();

  const user = {
    username: username.value,
    email: email.value,
    password: password.value,
    location: location.value
  };

  const res = await apiRequest("/auth/register", "POST", user);
  alert(res.message || "Registered!");

  if (res.token) {
    localStorage.setItem("token", res.token);
    window.location.href = "profile.html";
  }
}

async function loginUser(e) {
  e.preventDefault();

  const res = await apiRequest("/auth/login", "POST", {
    email: email.value,
    password: password.value
  });

  if (res.token) {
    localStorage.setItem("token", res.token);
    window.location.href = "profile.html";
  } else {
    alert(res.message);
  }
}

function logout() {
  localStorage.removeItem("token");
  window.location.href = "login.html";
}
