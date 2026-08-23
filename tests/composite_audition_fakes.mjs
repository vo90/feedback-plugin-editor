export class FakeAudioParam {
    constructor(value = 0) {
        this.value = value;
        this.events = [];
    }

    cancelScheduledValues(time) {
        this.events.push({ type: 'cancel', time });
    }

    setValueAtTime(value, time) {
        this.value = value;
        this.events.push({ type: 'set', value, time });
    }

    setTargetAtTime(value, time, constant) {
        this.value = value;
        this.events.push({ type: 'target', value, time, constant });
    }

    linearRampToValueAtTime(value, time) {
        this.value = value;
        this.events.push({ type: 'ramp', value, time });
    }
}

export class FakeAudioNode {
    constructor() {
        this.connections = [];
        this.disconnected = false;
    }

    connect(target) {
        this.connections.push(target);
        return target;
    }

    disconnect() {
        this.disconnected = true;
        this.connections = [];
    }
}

export class FakeGainNode extends FakeAudioNode {
    constructor() {
        super();
        this.gain = new FakeAudioParam(1);
    }
}

export class FakeBufferSourceNode extends FakeAudioNode {
    constructor() {
        super();
        this.buffer = null;
        this.starts = [];
        this.stopped = false;
    }

    start(...args) {
        this.starts.push(args);
    }

    stop() {
        this.stopped = true;
    }
}

export class FakeDynamicsCompressorNode extends FakeAudioNode {
    constructor() {
        super();
        this.threshold = new FakeAudioParam();
        this.knee = new FakeAudioParam();
        this.ratio = new FakeAudioParam();
        this.attack = new FakeAudioParam();
        this.release = new FakeAudioParam();
    }
}

export class FakeAudioContext {
    constructor({ state = 'running', decode = null } = {}) {
        this.currentTime = 0;
        this.state = state;
        this.destination = new FakeAudioNode();
        this.gains = [];
        this.sources = [];
        this.compressors = [];
        this.decode = decode;
        this.closed = false;
    }

    createGain() {
        const node = new FakeGainNode();
        this.gains.push(node);
        return node;
    }

    createBufferSource() {
        const node = new FakeBufferSourceNode();
        this.sources.push(node);
        return node;
    }

    createDynamicsCompressor() {
        const node = new FakeDynamicsCompressorNode();
        this.compressors.push(node);
        return node;
    }

    decodeAudioData(bytes, success, failure) {
        if (typeof this.decode === 'function') return this.decode(bytes, success, failure);
        const buffer = { duration: 4, bytes };
        queueMicrotask(() => success?.(buffer));
        return Promise.resolve(buffer);
    }

    async resume() {
        this.state = 'running';
    }

    async close() {
        this.state = 'closed';
        this.closed = true;
    }
}

export function createRafHarness() {
    let nextId = 1;
    const pending = new Map();
    return {
        request(callback) {
            const id = nextId++;
            pending.set(id, callback);
            return id;
        },
        cancel(id) {
            pending.delete(id);
        },
        step() {
            const callbacks = [...pending.values()];
            pending.clear();
            for (const callback of callbacks) callback();
        },
        get size() { return pending.size; },
    };
}
