/**
 * The standalone POS has a single Admin account, created by First-Time Setup.
 */
export const TEST_ADMIN = {
    // Step 1: Store Details
    store_name: 'E2E Test Store',
    store_address: '12 Rizal St., Quezon City',
    store_phone: '0917 000 1234',
    // Step 2: Admin Account
    name: 'Store Owner',
    phone_number: '0917 222 3333',
    address: '34 Mabini St.',
    city: 'Makati',
    province: 'Metro Manila',
    country: 'Philippines',
    // Step 3: Sign-in Method
    pin: '2580',
    // Step 4: Account Recovery (third one is a custom question)
    recovery: [
        { question: 'What was the name of your first pet?', answer: 'Bantay' },
        { question: 'What city were you born in?', answer: 'Cebu City' },
        { custom: 'What was the color of my first bike?', answer: 'Blue' },
    ],
};

/** A small valid PNG used as the store logo (generated locally, no external image). */
export const STORE_LOGO_PNG = {
    name: 'store-logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAA7EAAAOxAGVKw4bAAAAhElEQVRoge3asQ2DQBAAQb9FF5TiElwEARk9EVCE+3PmHCFrhLQT30u3uvTH/Noed/bUC1xVgFaAVoBWgFaAVoBWgDadfbC/j3/s8bN+llPzt79AAVoBWgFaAVoBWgFaAVoBWgFaAVoBWgFaAVoBWgHa6L8QVoBWgFaAVoBWgFaAVoD2BSv9BQGfcvA0AAAAAElFTkSuQmCC', 'base64'),
};

export const SAMPLE_PRODUCTS = {
    newProduct: {
        name: 'Automated Test Product',
        sku: 'AUTO-' + Date.now().toString().slice(-6),
        barcode: '880' + Math.floor(100000000 + Math.random() * 900000000),
        cost_price: '50.00',
        price: '99.00',
        wholesale_price: '79.00',
        stock_quantity: '50',
    }
};
