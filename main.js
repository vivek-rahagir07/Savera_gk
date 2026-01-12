// Import Firebase Modules (Modular SDK 11.6.1)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, addDoc, updateDoc, doc, onSnapshot, increment, query, where, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// ==========================================
// 1. CONFIGURATION & SETUP
// ==========================================

let db, auth, currentUser;
const COLL_USERS = 'users';
const COLL_SPACES = 'spaces';

// DOM Elements: Portal
const viewPortal = document.getElementById('view-portal');
const tabJoin = document.getElementById('tab-join');
const tabCreate = document.getElementById('tab-create');
const formJoin = document.getElementById('form-join');
const formCreate = document.getElementById('form-create');
const portalJoinName = document.getElementById('portal-join-name');
const portalJoinPass = document.getElementById('portal-join-pass');
const portalCreateName = document.getElementById('portal-create-name');
const portalCreatePass = document.getElementById('portal-create-pass');
const btnPortalJoin = document.getElementById('btn-portal-join');
const btnPortalCreate = document.getElementById('btn-portal-create');
const portalError = document.getElementById('portal-error');

// DOM Elements: Operation
const viewOperation = document.getElementById('view-operation');
const currentSpaceTitle = document.getElementById('current-space-title');
const btnExitWorkspace = document.getElementById('btn-exit-workspace');
const video = document.getElementById('video');
const canvas = document.getElementById('overlay');
const statusBadge = document.getElementById('system-status');
const liveLogsContainer = document.getElementById('live-logs');
const todayListContainer = document.getElementById('today-list');
const todayCountDisplay = document.getElementById('today-count');
const dateDisplay = document.getElementById('display-date');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');
const btnCapture = document.getElementById('btn-capture');
const regFeedback = document.getElementById('reg-feedback');
const btnExport = document.getElementById('btn-export');
const scanIndicator = document.getElementById('scan-indicator');
const dynamicFieldsContainer = document.getElementById('dynamic-fields-container');
const configForm = document.getElementById('config-form');
const attendInfo = document.getElementById('attend-info');
const regForm = document.getElementById('reg-form');

// State
let currentMode = 'attendance';
let currentSpace = null;
let labeledDescriptors = [];
let faceMatcher = null;
let isModelsLoaded = false;
let nameToDocId = {};
const attendanceCooldowns = {};
let allUsersData = [];

// Advanced Detection State
const VALIDATION_THRESHOLD = 5;
const detectionHistory = {};

// Set Live Date & Time
function updateLiveDateTime() {
    const now = new Date();
    const options = { weekday: 'short', month: 'short', day: 'numeric' };
    if (dateDisplay) dateDisplay.innerText = now.toLocaleDateString('en-US', options);
}
setInterval(updateLiveDateTime, 60000);
updateLiveDateTime();

// ==========================================
// 2. FIREBASE INIT & ANONYMOUS AUTH
// ==========================================

// Initialize Firebase
const firebaseConfig = {
    apiKey: "AIzaSyAf9xAmQtFZcvE8tvxpI-tU5teS89Dc6II",
    authDomain: "live-face-attendence-detection.firebaseapp.com",
    projectId: "live-face-attendence-detection",
    storageBucket: "live-face-attendence-detection.firebasestorage.app",
    messagingSenderId: "67072118378",
    appId: "1:67072118378:web:a988976e9233434b3fc413",
    measurementId: "G-RWGQV273WH"
};

try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);

    // Ensure anonymous auth for connectivity
    onAuthStateChanged(auth, (user) => {
        if (user) {
            currentUser = user;
            console.log("Authenticated as:", user.uid);
        } else {
            signInAnonymously(auth).catch(e => console.error("Auth Fail:", e));
        }
    });
} catch (e) {
    console.error("Firebase Init Error:", e);
}

// ==========================================
// 3. PORTAL & VIEW MANAGEMENT
// ==========================================

function showView(viewId) {
    [viewPortal, viewOperation].forEach(v => v ? v.classList.add('hidden') : null);
    const target = document.getElementById(viewId);
    if (target) target.classList.remove('hidden');
}

// Tab Switching
if (tabJoin) tabJoin.addEventListener('click', () => {
    tabJoin.classList.add('active');
    tabCreate.classList.remove('active');
    formJoin.classList.remove('hidden');
    formCreate.classList.add('hidden');
});

if (tabCreate) tabCreate.addEventListener('click', () => {
    tabCreate.classList.add('active');
    tabJoin.classList.remove('active');
    formCreate.classList.remove('hidden');
    formJoin.classList.add('hidden');
});

async function handleJoin() {
    const name = portalJoinName.value.trim();
    const password = portalJoinPass.value.trim();
    if (!name || !password) return alert("Enter name and password");

    const originalText = btnPortalJoin.innerText;
    btnPortalJoin.innerText = "Verifying...";
    btnPortalJoin.disabled = true;

    try {
        const q = query(collection(db, COLL_SPACES), where("name", "==", name));
        const querySnapshot = await getDocs(q);

        if (querySnapshot.empty) {
            portalError.innerText = "Workspace not found.";
            btnPortalJoin.innerText = originalText;
            btnPortalJoin.disabled = false;
            return;
        }

        let found = false;
        querySnapshot.forEach((doc) => {
            if (doc.data().password === password) {
                found = true;
                enterSpace(doc.id, doc.data());
            }
        });

        if (!found) {
            portalError.innerText = "Incorrect Password.";
            btnPortalJoin.innerText = originalText;
            btnPortalJoin.disabled = false;
        }
    } catch (err) {
        portalError.innerText = "Error: " + err.message;
        btnPortalJoin.innerText = originalText;
        btnPortalJoin.disabled = false;
    }
}

async function handleCreate() {
    const name = portalCreateName.value.trim();
    const password = portalCreatePass.value.trim();
    if (!name || !password) return alert("Enter name and password");
    if (password.length < 4) return alert("Password too short (min 4)");

    const originalText = btnPortalCreate.innerText;
    btnPortalCreate.innerText = "Initialising...";
    btnPortalCreate.disabled = true;

    try {
        const q = query(collection(db, COLL_SPACES), where("name", "==", name));
        const snap = await getDocs(q);
        if (!snap.empty) {
            alert("Name already taken!");
            btnPortalCreate.innerText = originalText;
            btnPortalCreate.disabled = false;
            return;
        }

        const docRef = await addDoc(collection(db, COLL_SPACES), {
            name: name,
            password: password,
            createdAt: new Date(),
            config: { regNo: true, course: true, phone: false }
        });

        enterSpace(docRef.id, { name, password, config: { regNo: true, course: true, phone: false } });
    } catch (err) {
        portalError.innerText = "Create Error: " + err.message;
        btnPortalCreate.innerText = originalText;
        btnPortalCreate.disabled = false;
    }
}

function enterSpace(id, data) {
    currentSpace = { id, ...data };
    currentSpaceTitle.innerText = currentSpace.name;
    portalError.innerText = "";
    showView('view-operation');
    initSystem();
    startDbListener();
    updateRegistrationForm();
}

btnPortalJoin.addEventListener('click', handleJoin);
btnPortalCreate.addEventListener('click', handleCreate);
btnExitWorkspace.addEventListener('click', () => {
    currentSpace = null;
    showView('view-portal');
});

// ==========================================
// 4. FACE API & CAMERA
// ==========================================

const MODEL_URL = 'https://justadudewhohacks.github.io/face-api.js/models';
// Fallback URL if the primary one fails
const FALLBACK_MODEL_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/';

async function loadModels(url) {
    try {
        statusBadge.innerText = "Loading Models...";
        loadingText.innerText = `Loading AI models from ${url.includes('github') ? 'GitHub' : 'CDN'}...`;

        await Promise.all([
            faceapi.nets.ssdMobilenetv1.loadFromUri(url),
            faceapi.nets.faceLandmark68Net.loadFromUri(url),
            faceapi.nets.faceRecognitionNet.loadFromUri(url)
        ]);

        console.log("Models Loaded successfully from", url);
        return true;
    } catch (err) {
        console.warn(`Failed to load models from ${url}:`, err);
        return false;
    }
}

async function initSystem() {
    if (isModelsLoaded) {
        if (!video.srcObject) startVideo();
        return;
    }
    console.log("Initializing Attendance SystemAI...");

    // Check if we are on file:// protocol, which often breaks modules/fetch
    if (window.location.protocol === 'file:') {
        console.warn("Running on file:// protocol. This may cause CORS issues with module imports and fetch requests.");
        // Try to explain to the user if it gets stuck
        setTimeout(() => {
            if (!isModelsLoaded) {
                loadingText.innerHTML = "Stuck Loading? <br><small>Browsers often block local file access. <br>Try opening this folder in VS Code and using 'Live Server'.</small>";
            }
        }, 8000);
    }

    let loaded = await loadModels(MODEL_URL);
    if (!loaded) {
        console.log("Trying fallback model URL...");
        loaded = await loadModels(FALLBACK_MODEL_URL);
    }

    if (loaded) {
        console.log("Models Loaded. Requesting camera access...");
        isModelsLoaded = true;
        loadingText.innerText = "Requesting Camera Access...";
        startVideo();
    } else {
        loadingText.innerHTML = "Error: Could not load AI models. <br><small>Please check your internet connection.</small>";
        statusBadge.innerText = "Load Error";
        statusBadge.className = "status-badge status-error";

        // Add a retry button to the UI
        const retryBtn = document.createElement('button');
        retryBtn.innerText = "Retry Loading";
        retryBtn.className = "btn-primary";
        retryBtn.style.marginTop = "10px";
        retryBtn.onclick = () => window.location.reload();
        loadingOverlay.appendChild(retryBtn);
    }
}

// System initialization will be triggered when entering a space
// initSystem();

function startVideo() {
    statusBadge.innerText = "Accessing Camera...";

    const constraints = {
        video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user"
        }
    };

    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            console.log("Camera access granted.");
            video.srcObject = stream;
            // Wait for video to actually start playing
            video.onloadedmetadata = () => {
                video.play().then(() => {
                    console.log("Video playing.");
                    loadingOverlay.style.display = "none";
                    statusBadge.innerText = "System Active";
                    statusBadge.className = "status-badge status-ready";
                }).catch(err => {
                    console.error("Video Play Error:", err);
                    loadingText.innerHTML = "Click to Start Camera";
                    // Add a button since some browsers block auto-play
                    const startBtn = document.createElement('button');
                    startBtn.innerText = "Start Camera";
                    startBtn.className = "btn-primary";
                    startBtn.onclick = () => {
                        video.play();
                        loadingOverlay.style.display = "none";
                        statusBadge.innerText = "System Active";
                    };
                    loadingOverlay.appendChild(startBtn);
                });
            };
        })
        .catch(err => {
            console.error("Camera Error:", err);
            loadingText.innerHTML = "Camera Access Denied <br><small>Please enable camera in your browser settings.</small>";
            statusBadge.innerText = "Camera Error";
            statusBadge.className = "status-badge status-error";

            // Show overlay with error color
            loadingOverlay.style.background = "rgba(120, 0, 0, 0.9)";

            // Add a troubleshooting button
            const helpBtn = document.createElement('button');
            helpBtn.innerText = "How to fix?";
            helpBtn.className = "btn-secondary";
            helpBtn.style.marginTop = "10px";
            helpBtn.onclick = () => alert("1. Click the lock icon in the address bar.\n2. Ensure Camera is set to 'Allow'.\n3. Refresh the page.");
            loadingOverlay.appendChild(helpBtn);
        });
}


// ==========================================
// 4. SPACE CONFIG & DYNAMIC FORM
// ==========================================

function updateRegistrationForm() {
    if (!currentSpace) return;
    const config = currentSpace.config || {};
    dynamicFieldsContainer.innerHTML = '';

    // Always include Name
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.id = 'reg-name';
    nameInput.placeholder = 'Full Name';
    dynamicFieldsContainer.appendChild(nameInput);

    // Check for optional fields
    if (config.regNo) {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'reg-regNo';
        input.placeholder = 'Registration Number';
        dynamicFieldsContainer.appendChild(input);
    }
    if (config.course) {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'reg-course';
        input.placeholder = 'Course / Department';
        dynamicFieldsContainer.appendChild(input);
    }
    if (config.phone) {
        const input = document.createElement('input');
        input.type = 'text';
        input.id = 'reg-phone';
        input.placeholder = 'Phone Number';
        dynamicFieldsContainer.appendChild(input);
    }
}

async function saveSpaceConfig() {
    if (!currentSpace) return;
    const newConfig = {};
    document.querySelectorAll('.field-toggle').forEach(el => {
        newConfig[el.dataset.field] = el.checked;
    });

    try {
        await updateDoc(doc(db, COLL_SPACES, currentSpace.id), { config: newConfig });
        currentSpace.config = newConfig; // Update local state
        alert("Settings saved!");
        setMode('attendance');
    } catch (err) {
        alert(err.message);
    }
}

document.getElementById('btn-save-config').addEventListener('click', saveSpaceConfig);

// Handle toggle inputs initial state when entering Settings mode
function syncConfigToggles() {
    if (!currentSpace) return;
    const config = currentSpace.config || {};
    document.querySelectorAll('.field-toggle').forEach(el => {
        el.checked = !!config[el.dataset.field];
    });
}

// ==========================================
// 5. DATABASE LISTENER (WORKSPACE AWARE)
// ==========================================

let unsubscribeUsers = null;

function startDbListener() {
    if (!currentSpace) return;
    if (unsubscribeUsers) unsubscribeUsers();

    // Clear previous detection data immediately to ensure isolation
    labeledDescriptors = [];
    faceMatcher = null;
    nameToDocId = {};
    allUsersData = [];
    todayListContainer.innerHTML = '<div style="padding:10px; text-align:center; color:#888;">Switching workspace...</div>';

    const q = query(collection(db, COLL_USERS), where("spaceId", "==", currentSpace.id));

    unsubscribeUsers = onSnapshot(q, (snapshot) => {
        const descriptors = [];
        const tempMap = {};
        const tempAllData = [];
        let presentTodayCount = 0;
        let todayAttendeesHTML = '';
        const todayStr = new Date().toDateString();

        snapshot.forEach(doc => {
            const data = doc.data();
            tempAllData.push(data);

            if (data.name && data.descriptor) {
                try {
                    const descFloat32 = new Float32Array(data.descriptor);
                    descriptors.push(new faceapi.LabeledFaceDescriptors(data.name, [descFloat32]));
                    tempMap[data.name] = doc.id;
                } catch (e) {
                    console.warn("Skipping corrupt face data", data.name);
                }
            }

            if (data.lastAttendance === todayStr) {
                presentTodayCount++;
                todayAttendeesHTML += `
                    <div class="list-item">
                        <div>
                            <strong>${data.name}</strong>
                            <span class="badge-course">${data.course || data.regNo || ''}</span>
                        </div>
                        <div style="color:var(--success)">✔</div>
                    </div>
                `;
            }
        });

        labeledDescriptors = descriptors;
        nameToDocId = tempMap;
        allUsersData = tempAllData;

        if (labeledDescriptors.length > 0) {
            faceMatcher = new faceapi.FaceMatcher(labeledDescriptors, 0.4);
        }

        todayCountDisplay.innerText = presentTodayCount;
        todayListContainer.innerHTML = todayAttendeesHTML || '<div style="padding:10px; text-align:center; color:#888;">No attendance yet today</div>';
    });
}

// ==========================================
// 4. MAIN LOOP
// ==========================================

video.addEventListener('play', () => {
    const displaySize = { width: video.videoWidth || 640, height: video.videoHeight || 480 };
    faceapi.matchDimensions(canvas, displaySize);

    setInterval(async () => {
        if (!isModelsLoaded || !video.srcObject) return;

        // Skip processing if registering or if tab is hidden
        if (currentMode === 'registration' || document.hidden) {
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        // Detect
        const detections = await faceapi.detectAllFaces(video)
            .withFaceLandmarks()
            .withFaceDescriptors();

        const resizedDetections = faceapi.resizeResults(detections, displaySize);

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // UI Feedback: Scanning indicator
        if (detections.length > 0) {
            if (scanIndicator) scanIndicator.style.display = 'block';
        } else {
            if (scanIndicator) scanIndicator.style.display = 'none';
        }

        if (!faceMatcher) return;

        const results = resizedDetections.map(d => faceMatcher.findBestMatch(d.descriptor));

        results.forEach((result, i) => {
            const box = resizedDetections[i].detection.box;
            const { label, distance } = result;

            // Draw
            const isUnknown = label === 'unknown';
            const boxColor = isUnknown ? '#EF4444' : '#6366F1';
            const confidence = Math.round((1 - distance) * 100);
            const drawLabel = isUnknown ? 'Unknown' : `${label} (${confidence}%)`;

            const drawBox = new faceapi.draw.DrawBox(box, {
                label: drawLabel,
                boxColor: boxColor,
                drawLabelOptions: {
                    fontSize: 14,
                    fontStyle: 'bold',
                    fontColor: 'white',
                    backgroundColor: boxColor
                }
            });
            drawBox.draw(canvas);

            // Validation logic
            if (!isUnknown) {
                detectionHistory[label] = (detectionHistory[label] || 0) + 1;

                // Visual validation feedback (Optional: could show a small progress bar)
                if (detectionHistory[label] >= VALIDATION_THRESHOLD) {
                    markAttendance(label);
                    detectionHistory[label] = 0; // Reset after trigger
                }
            } else {
                // If unknown, we could optionally reset detection history for others
                // But generally, we just don't increment anything
            }
        });

        // Cleanup detection history for people not in frame
        Object.keys(detectionHistory).forEach(name => {
            const isStillInFrame = results.some(r => r.label === name);
            if (!isStillInFrame) {
                detectionHistory[name] = Math.max(0, (detectionHistory[name] || 0) - 1);
            }
        });
    }, 100); // Check every 100ms
});


async function registerUser() {
    if (!currentUser || !currentSpace) {
        alert("System not ready.");
        return;
    }

    const nameEl = document.getElementById('reg-name');
    const name = nameEl ? nameEl.value.trim() : '';

    if (!name) {
        alert("Name is required.");
        return;
    }

    // Collect dynamic fields meta
    const metadata = {};
    if (document.getElementById('reg-regNo')) metadata.regNo = document.getElementById('reg-regNo').value.trim();
    if (document.getElementById('reg-course')) metadata.course = document.getElementById('reg-course').value.trim();
    if (document.getElementById('reg-phone')) metadata.phone = document.getElementById('reg-phone').value.trim();

    regFeedback.innerText = "Scanning...";
    regFeedback.style.color = "var(--primary)";

    const detection = await faceapi.detectSingleFace(video)
        .withFaceLandmarks()
        .withFaceDescriptor();

    if (detection) {
        // Check if name already exists in THIS SPACE
        if (nameToDocId[name]) {
            alert("A user with this name already exists in this workspace.");
            regFeedback.innerText = "Name taken.";
            return;
        }

        const descriptorArray = Array.from(detection.descriptor);

        try {
            await addDoc(collection(db, COLL_USERS), {
                spaceId: currentSpace.id,
                name: name,
                ...metadata, // Save course/regNo/phone at top level for compatibility
                descriptor: descriptorArray,
                attendanceCount: 0,
                lastAttendance: null,
                createdAt: new Date()
            });

            alert(`Registered ${name} successfully!`);
            nameEl.value = "";
            if (document.getElementById('reg-regNo')) document.getElementById('reg-regNo').value = "";
            if (document.getElementById('reg-course')) document.getElementById('reg-course').value = "";
            if (document.getElementById('reg-phone')) document.getElementById('reg-phone').value = "";
            regFeedback.innerText = "Success!";
            regFeedback.style.color = "var(--success)";

        } catch (error) {
            console.error("Write Error:", error);
            alert("Failed to save data: " + error.message);
        }
    } else {
        regFeedback.innerText = "No face detected. Look at camera.";
        regFeedback.style.color = "var(--danger)";
    }
}

async function markAttendance(name) {
    const now = Date.now();
    const lastMarked = attendanceCooldowns[name] || 0;

    // 1 minute cooldown
    if (now - lastMarked < 60000) return;

    attendanceCooldowns[name] = now;
    const timeStr = new Date().toLocaleTimeString();

    addLiveLogEntry(name, timeStr);

    const docId = nameToDocId[name];
    if (!docId) return;

    try {
        const userDocRef = doc(db, COLL_USERS, docId);
        const todayDate = new Date().toDateString();

        await updateDoc(userDocRef, {
            lastAttendance: todayDate,
            attendanceCount: increment(1)
        });

    } catch (err) {
        console.error("Attendance Update Error:", err);
    }
}

// ==========================================
// 6. UI HANDLERS
// ==========================================

document.getElementById('btn-mode-attend').addEventListener('click', () => setMode('attendance'));
document.getElementById('btn-mode-reg').addEventListener('click', () => setMode('registration'));
document.getElementById('btn-mode-config').addEventListener('click', () => setMode('config'));

if (btnCapture) btnCapture.addEventListener('click', registerUser);
if (btnExport) btnExport.addEventListener('click', exportToCSV);

function setMode(mode) {
    currentMode = mode;

    // UI elements update
    [regForm, attendInfo, configForm].forEach(el => el.classList.add('hidden'));
    [
        document.getElementById('btn-mode-attend'),
        document.getElementById('btn-mode-reg'),
        document.getElementById('btn-mode-config')
    ].forEach(btn => btn.classList.remove('active'));

    if (mode === 'registration') {
        regForm.classList.remove('hidden');
        document.getElementById('btn-mode-reg').classList.add('active');
        statusBadge.innerText = "Registration Mode";
        updateRegistrationForm(); // Ensure fields are fresh
    } else if (mode === 'config') {
        configForm.classList.remove('hidden');
        document.getElementById('btn-mode-config').classList.add('active');
        statusBadge.innerText = "Configuration Mode";
        syncConfigToggles();
    } else {
        attendInfo.classList.remove('hidden');
        document.getElementById('btn-mode-attend').classList.add('active');
        statusBadge.innerText = "Attendance Mode";
    }
}

function addLiveLogEntry(name, time) {
    const div = document.createElement('div');
    div.className = 'list-item';
    div.innerHTML = `
        <span><strong>${name}</strong></span>
        <span class="log-success">seen @ ${time}</span>
    `;
    liveLogsContainer.prepend(div);
    // Limit log entries to 50 for performance
    if (liveLogsContainer.children.length > 50) {
        liveLogsContainer.removeChild(liveLogsContainer.lastChild);
    }
}

function exportToCSV() {
    if (allUsersData.length === 0) {
        alert("No data available for this workspace.");
        return;
    }

    const headers = ["Name", "Reg No", "Course", "Phone", "Total Attendance", "Last Seen"];
    const rows = allUsersData.map(u => [
        `"${u.name || 'Unknown'}"`,
        `"${u.regNo || 'N/A'}"`,
        `"${u.course || 'N/A'}"`,
        `"${u.phone || 'N/A'}"`,
        u.attendanceCount || 0,
        `"${u.lastAttendance || 'Never'}"`
    ]);

    const csvContent = headers.join(",") + "\n" + rows.map(r => r.join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance_${currentSpace.name.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

setMode('attendance');
