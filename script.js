const $ = (id) => document.getElementById(id);
let records = [];
let editingId = null;

const form = $("studentForm");
const saveBtn = $("saveBtn");
const saveBtnText = $("saveBtnText");
const searchInput = $("searchInput");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'\"':"&quot;", "'":"&#39;"}[char]));
}

function initials(name) {
  return String(name).trim().split(/\s+/).slice(0,2).map(part => part[0]?.toUpperCase() || "").join("") || "ST";
}

function toast(message, error = false) {
  const el = $("toast");
  el.textContent = message;
  el.className = "toast show" + (error ? " error" : "");
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.className = "toast", 2800);
}

function clearForm() {
  editingId = null;
  form.reset();
  $("studentId").value = "";
  $("studentYear").value = "2nd Year";
  $("studentGpa").value = "8.50";
  $("studentAge").value = "20";
  $("studentAttendance").value = "85";
  $("formTitle").textContent = "Add student information";
  saveBtnText.textContent = "Add Student";
  $("formNote").textContent = "Student ID becomes the unique dictionary key. Existing IDs cannot be duplicated.";
}

function fillForm(student) {
  editingId = student.id;
  $("studentId").value = student.id;
  $("studentName").value = student.name;
  $("studentCourse").value = student.course;
  $("studentYear").value = student.year;
  $("studentGpa").value = student.gpa;
  $("studentAge").value = student.age;
  $("studentEmail").value = student.email === "Not provided" ? "" : student.email;
  $("studentAttendance").value = student.attendance;
  $("formTitle").textContent = `Update ${student.name}`;
  saveBtnText.textContent = "Update Record";
  $("formNote").textContent = `Editing ${student.id}. You can also change the Student ID.`;
  $("studentId").focus();
  document.querySelector("#entry").scrollIntoView({behavior:"smooth", block:"start"});
}

function payload() {
  return {
    id: $("studentId").value.trim(),
    name: $("studentName").value.trim(),
    course: $("studentCourse").value.trim(),
    year: $("studentYear").value,
    gpa: $("studentGpa").value,
    age: $("studentAge").value,
    email: $("studentEmail").value.trim(),
    attendance: $("studentAttendance").value
  };
}

function renderStats() {
  const count = records.length;
  const avgGpa = count ? records.reduce((sum, s) => sum + Number(s.gpa), 0) / count : 0;
  const maxGpa = count ? Math.max(...records.map(s => Number(s.gpa))) : 0;
  const avgAttendance = count ? records.reduce((sum, s) => sum + Number(s.attendance), 0) / count : 0;
  $("recordCount").textContent = count;
  $("totalStudents").textContent = count;
  $("avgGpa").textContent = avgGpa.toFixed(2);
  $("highestGpa").textContent = maxGpa.toFixed(2);
  $("avgAttendance").textContent = `${avgAttendance.toFixed(1)}%`;
}

function render() {
  const q = searchInput.value.trim().toLowerCase();
  const filtered = records.filter((s) => [s.id, s.name, s.course, s.year, s.email].some(v => String(v).toLowerCase().includes(q)));
  $("matchCount").textContent = filtered.length;
  const body = $("tableBody");
  body.innerHTML = filtered.map((s) => `
    <tr>
      <td>
        <div class="student-cell">
          <div class="avatar">${escapeHtml(initials(s.name))}</div>
          <div><div class="student-name">${escapeHtml(s.name)}</div><span class="id-chip">${escapeHtml(s.id)}</span><span class="student-meta">${escapeHtml(s.email)}</span></div>
        </div>
      </td>
      <td>${escapeHtml(s.course)}</td>
      <td>${escapeHtml(s.year)}</td>
      <td><span class="badge att">${Number(s.attendance).toFixed(1)}%</span></td>
      <td><span class="badge gpa">${Number(s.gpa).toFixed(2)}</span></td>
      <td class="actions">
        <button class="action" data-action="edit" data-id="${escapeHtml(s.id)}">Edit</button>
        <button class="action delete" data-action="delete" data-id="${escapeHtml(s.id)}">Delete</button>
      </td>
    </tr>`).join("");
  $("emptyState").hidden = filtered.length !== 0;
  if (filtered.length === 0) body.innerHTML = "";
  renderStats();
}

async function load() {
  try {
    const response = await fetch("/api/students", {cache:"no-store"});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load records");
    records = data.students || [];
    render();
  } catch (error) {
    toast(error.message, true);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = payload();
  if (!data.id || !data.name || !data.course) {
    toast("Please fill Student ID, student name and course.", true);
    return;
  }
  const method = editingId ? "PUT" : "POST";
  const url = editingId ? `/api/students/${encodeURIComponent(editingId)}` : "/api/students";
  saveBtn.disabled = true;
  try {
    const response = await fetch(url, {method, headers:{"Content-Type":"application/json"}, body:JSON.stringify(data)});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save record");
    toast(result.message || "Saved successfully");
    clearForm();
    await load();
  } catch (error) {
    toast(error.message, true);
  } finally {
    saveBtn.disabled = false;
  }
});

$("clearBtn").addEventListener("click", () => { clearForm(); toast("Form cleared"); });
$("refreshBtn").addEventListener("click", async () => { await load(); toast("Dictionary refreshed"); });
searchInput.addEventListener("input", render);

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.focus();
  }
});

$("tableBody").addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const id = button.dataset.id;
  const student = records.find(s => s.id === id);
  if (!student) return;
  if (button.dataset.action === "edit") {
    fillForm(student);
    return;
  }
  if (!confirm(`Delete ${student.name} (${student.id})?`)) return;
  try {
    const response = await fetch(`/api/students/${encodeURIComponent(id)}`, {method:"DELETE"});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Delete failed");
    toast(result.message || "Student deleted");
    if (editingId === id) clearForm();
    await load();
  } catch (error) {
    toast(error.message, true);
  }
});

$("loadExample").addEventListener("click", async () => {
  const examples = [
    {id:"STU101",name:"Ananya Rao",age:19,course:"Computer Science",year:"1st Year",email:"ananya.rao@example.com",attendance:92,gpa:9.1},
    {id:"STU102",name:"Rahul Mehta",age:20,course:"Information Science",year:"2nd Year",email:"rahul.mehta@example.com",attendance:87,gpa:8.4},
    {id:"STU103",name:"Meera Nair",age:21,course:"Artificial Intelligence",year:"3rd Year",email:"meera.nair@example.com",attendance:95,gpa:9.5},
    {id:"STU104",name:"Kiran Kumar",age:20,course:"Electronics",year:"2nd Year",email:"kiran.kumar@example.com",attendance:84,gpa:8.0},
    {id:"STU105",name:"Diya Patel",age:19,course:"Computer Science",year:"1st Year",email:"diya.patel@example.com",attendance:90,gpa:9.0},
    {id:"STU106",name:"Arjun Singh",age:22,course:"Mechanical Engineering",year:"4th Year",email:"arjun.singh@example.com",attendance:78,gpa:7.8}
  ];
  const button = $("loadExample");
  button.disabled = true;
  try {
    for (const student of examples) {
      const response = await fetch("/api/students", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(student)});
      if (![201,409].includes(response.status)) {
        const result = await response.json();
        throw new Error(result.error || "Example loading failed");
      }
    }
    await load();
    toast("Example records are ready");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

clearForm();
load();
