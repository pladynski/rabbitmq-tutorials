'use strict';

// Graftcode: the public static method below is what Graftcode Gateway (gg) exposes
// in place of the rpc_queue consumer. It runs the same fibonacci() as rpc_server.js.

const { fibonacci } = require('./rpc_server');

class FibonacciService {
    /**
     * @param {number} n
     * @returns {number}
     */
    static fib(n) {
        console.log(" [.] fib(%d)", n);
        return fibonacci(n);
    }
}

module.exports = { FibonacciService };
