const { core } = Deno;
const { ops } = core;
const Path = {
    isAbsolute: (path) => path.startsWith('/') || /^[A-Za-z]:\\/.test(path),
    join: (...parts) => parts.join('/').replace(/\/+/g, '/'),
};

function argsToMessage(...args) {
    return args.map((arg) => JSON.stringify(arg)).join(" ");
}

const sendLog = async (level, ...args) => {
    const message = argsToMessage(...args);
    const logApiUrl = process.env.SCREENPIPE_LOG_API_URL || "http://localhost:11435/log";
    const pipeId = globalThis.metadata.id || "unknown";

    try {
        await ops.op_fetch(logApiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                pipeId,
                level,
                message,
                timestamp: new Date().toISOString(),
            }),
        });
    } catch (error) {
        // core.print(`[js][error]: Failed to send log: ${error}\n`, true);
    }
};

const console = {
    log: (...args) => {
        core.print(`[js][info]: ${argsToMessage(...args)}\n`, false);
        // sendLog("info", ...args);
    },
    error: (...args) => {
        core.print(`[js][error]: ${argsToMessage(...args)}\n`, true);
        // sendLog("error", ...args);
    },
};

globalThis.console = console;

const pipe = {
    readFile: (path) => {
        let fullPath;
        if (Path.isAbsolute(path)) {
            fullPath = path;
        } else {
            const pipeDir = `${process.env.SCREENPIPE_DIR}/pipes/${globalThis.metadata.id}`;
            fullPath = Path.join(pipeDir, path);
        }
        return ops.op_read_file(fullPath);
    },

    removeFile: (path) => {
        let fullPath;
        if (Path.isAbsolute(path)) {
            fullPath = path;
        } else {
            const pipeDir = `${process.env.SCREENPIPE_DIR}/pipes/${globalThis.metadata.id}`;
            fullPath = Path.join(pipeDir, path);
        }
        return ops.op_remove_file(fullPath);
    },

    get: async (url) => {
        const response = await ops.op_fetch_get(url);
        return JSON.parse(response);
    },
    post: async (url, body) => {
        const response = await ops.op_fetch_post(url, body);
        return JSON.parse(response);
    },
    fetch: async (url, options) => {
        try {
            const responseString = await ops.op_fetch(url, options);
            const response = JSON.parse(responseString);
            return {
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                statusText: response.statusText,
                headers: response.headers, // Use the headers directly without wrapping in Headers object
                text: async () => response.text,
                json: async () => {
                    try {
                        return JSON.parse(response.text);
                    } catch (error) {
                        console.error("Error parsing JSON:", error);
                        return response.text;
                    }
                },
            };
        } catch (error) {
            console.error("Fetch error:", error);
            throw error;
        }
    },
    sendNotification: async ({ title, body }) => {
        // try to fetch this url, if not live do try to send the notification to the server
        const notificationApiUrl = process.env.SCREENPIPE_SERVER_URL || "http://localhost:11435";

        try {
            const response = await ops.op_fetch(notificationApiUrl + "/notify", {
                headers: {
                    "Content-Type": "application/json",
                },
                method: "POST",
                body: JSON.stringify({ title, body })
            });
            console.log("Notification sent:", response);
            return JSON.parse(response);
        } catch (error) {
            console.log("Failed to send notification to server, is your notification server running?");
            return false;
        }
    },
    loadConfig: async () => {
        try {
            console.log("Attempting to load pipe.json");
            const configContent = await ops.op_read_file(process.env.SCREENPIPE_DIR + "/pipes/" + globalThis.metadata.id + "/pipe.json");
            console.log("pipe.json content:", configContent);
            const parsedConfig = JSON.parse(configContent);
            console.log("Parsed config:", parsedConfig);

            // Process the fields and set the config values
            const config = {};
            parsedConfig.fields.forEach(field => {
                config[field.name] = field.value !== undefined ? field.value : field.default;
            });

            pipe.config = config; // Set the processed config
            console.log("Processed config:", config);
            return config;
        } catch (error) {
            console.error("Error loading pipe.json:", error);
            pipe.config = {}; // Set an empty object if loading fails
            return {};
        }
    },
    sendEmail: async ({ to, from, password, subject, body }) => {
        try {
            await ops.op_send_email(to, from, password, subject, body);
            return true;
        } catch (error) {
            console.error("Error sending email:", error);
            return false;
        }
    },
    // isEnabled: async () => {
    //     return ops.op_is_enabled();
    // }
};

const fs = { // TODO does not work?
    readFileSync: (path) => {
        // This is a synchronous wrapper around the async operation
        // Note: This will block the event loop and should be used carefully
        return new Promise((resolve, reject) => {
            ops.op_read_file(path)
                .then(resolve)
                .catch(reject);
        });
    },
    writeFileSync: (path, contents) => {
        // Similarly, this is a synchronous wrapper
        return new Promise((resolve, reject) => {
            ops.op_write_file(path, contents)
                .then(resolve)
                .catch(reject);
        });
    },
    readdirSync: (path) => {
        return new Promise((resolve, reject) => {
            ops.op_readdir(path)
                .then(resolve)
                .catch(reject);
        });
    },
    mkdirSync: (path) => {
        // This is a synchronous wrapper around the async operation
        return new Promise((resolve, reject) => {
            ops.op_create_dir(path)
                .then(resolve)
                .catch(reject);
        });
    },
    statSync: (path) => {
        // This is a synchronous wrapper around the async operation
        return new Promise((resolve, reject) => {
            ops.op_stat(path)
                .then(resolve)
                .catch(reject);
        });
    }
};

const path = {
    join: (...paths) => {
        const sep = process.env.OS === "windows" ? "\\" : "/";
        // This implementation works on both Unix and Windows
        return paths.join(sep).replace(new RegExp(`\\${sep}+`, 'g'), sep);
    },
};

globalThis.fs = fs;
globalThis.path = path;

globalThis.setTimeout = (callback, delay) => {
    ops.op_set_timeout(delay).then(callback);
};
globalThis.pipe = pipe;
globalThis.pipe.metadata = globalThis.metadata;
globalThis.fetch = pipe.fetch;
globalThis.loadConfig = pipe.loadConfig;