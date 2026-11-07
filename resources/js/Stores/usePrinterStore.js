import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import Swal from 'sweetalert2';
import { router } from '@inertiajs/react';
import { Capacitor } from '@capacitor/core';
import { BleClient } from '@capacitor-community/bluetooth-le';

const encode = (text) => new TextEncoder().encode(text);
const formatCurrency = (amount) => parseFloat(amount || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

/**
 * Global Printer Store (Zustand)
 * Centralized logic for USB/Bluetooth hardware management.
 * Handles persistence, auto-reconnect on plug-in, and real-time disconnection.
 */
const usePrinterStore = create(
    persist(
        (set, get) => ({
            // --- PERSISTENT SETTINGS (Saved in LocalStorage) ---
            paperWidth: '80mm',
            isPrinterEnabled: false, // Tracks if the user INTENTIONALLY wants the printer active

            // --- VOLATILE STATE (In-Memory only) ---
            usbDevice: null,
            bluetoothDevice: null,
            isMobile: /Android|iPhone|iPad/i.test(navigator.userAgent),

            setPaperWidth: (width) => set({ paperWidth: width }),

            _claimInterfaceForDevice: async (device) => {
                if (!device.opened) {
                    await device.open();
                }
                if (device.configuration === null) {
                    await device.selectConfiguration(1);
                }

                // Find interface with direction === 'out' endpoint
                let foundIfaceNumber = null;
                for (const iface of device.configuration.interfaces) {
                    for (const alt of iface.alternates || [iface.alternate]) {
                        const found = alt.endpoints.find(e => e.direction === 'out');
                        if (found) {
                            foundIfaceNumber = iface.interfaceNumber;
                            break;
                        }
                    }
                    if (foundIfaceNumber !== null) break;
                }

                // Default to interface 0 if not found
                const targetInterface = foundIfaceNumber !== null ? foundIfaceNumber : 0;
                try {
                    await device.claimInterface(targetInterface);
                } catch (claimErr) {
                    console.warn("USB interface claim skipped or protected:", claimErr.message);
                }
                return targetInterface;
            },

            /**
             * Initializes listeners for physical hardware events.
             * Prevents redundant listeners by removing old ones first.
             */
            setupUsbListeners: () => {
                if (typeof navigator !== 'undefined' && navigator.usb) {
                    // Listen for USB Unplug
                    navigator.usb.removeEventListener('disconnect', get()._handlePhysicalDisconnect);
                    navigator.usb.addEventListener('disconnect', get()._handlePhysicalDisconnect);

                    // Listen for USB Plug-in (Auto-connect for previously paired devices)
                    navigator.usb.removeEventListener('connect', get()._handlePhysicalConnect);
                    navigator.usb.addEventListener('connect', get()._handlePhysicalConnect);
                }
            },

            /**
             * Internal handler for when the USB cable is physically plugged in.
             * This only works if the user has previously granted permission to this specific printer.
             */
            _handlePhysicalConnect: async (event) => {
                const { isPrinterEnabled } = get();

                // Only auto-connect if the user actually has printing enabled in settings
                if (isPrinterEnabled) {
                    try {
                        const device = event.device;
                        await get()._claimInterfaceForDevice(device);

                        set({ usbDevice: device });

                        // Show a quiet toast notification instead of a big alert
                        Swal.fire({ icon: 'success', title: 'Printer Online', toast: true, position: 'bottom-end', showConfirmButton: false, timer: 3000 });
                    } catch (error) {
                        console.warn("Auto-connect on plug failed:", error);
                    }
                }
            },

            /**
             * Internal handler for when the USB cable is pulled or power is cut.
             */
            _handlePhysicalDisconnect: (event) => {
                const { usbDevice } = get();
                // We check if the device that was disconnected is OUR printer, or if we just lost connection
                if (!usbDevice || (usbDevice && event.device === usbDevice)) {
                    // We set usbDevice to null, but KEEP isPrinterEnabled as true.
                    // This tells the system "The hardware is missing, but the user still wants it when it returns."
                    set({ usbDevice: null });
                    Swal.fire({ icon: 'warning', title: 'Printer Offline', text: 'USB Disconnected', toast: true, position: 'bottom-end', showConfirmButton: false, timer: 3000 });
                }
            },

            /**
             * Internal handler for Bluetooth signal loss.
             */
            _handleBtDisconnect: () => {
                console.log('Bluetooth connection lost.');
                // We do NOT set bluetoothDevice to null here!
                // We keep it in memory so we can attempt a "Silent Wake-up" later.
                Swal.fire({ icon: 'warning', title: 'Printer Asleep', text: 'Will auto-wake on next print.', toast: true, position: 'bottom-end', timer: 3000, showConfirmButton: false });
            },

            /**
             * Essential for SPA/Inertia: Re-establishes the hardware link
             * when shifting pages or refreshing.
             */
            autoConnectUsb: async () => {
                const { isMobile, isPrinterEnabled, usbDevice } = get();

                // Skip if mobile, manually disabled, or already linked in memory
                if (isMobile || !isPrinterEnabled || usbDevice) return;

                try {
                    const devices = await navigator.usb.getDevices();
                    if (devices.length > 0) {
                        const device = devices[0];

                        await get()._claimInterfaceForDevice(device);
                        set({ usbDevice: device });

                        // Setup listeners in case they refresh the page while it's plugged in
                        get().setupUsbListeners();
                    }
                } catch (err) {
                    console.warn("Auto-connect on refresh failed:", err);
                    set({ usbDevice: null });
                }
            },

            // UPGRADED SMART CONNECT: Quietly attempts known devices before prompting
            connectUsb: async () => {
                try {
                    let device = null;

                    // 1. SMART RECONNECT: Check if the browser already has an authorized printer
                    const existingDevices = await navigator.usb.getDevices();
                    if (existingDevices.length > 0) {
                        try {
                            const knownDevice = existingDevices[0]; // Grab the first authorized device
                            await get()._claimInterfaceForDevice(knownDevice);
                            device = knownDevice; // Silent connection successful!
                        } catch (silentError) {
                            console.warn("Silent reconnect failed, falling back to popup...", silentError);
                            device = null; // Reset to force popup
                        }
                    }

                    // 2. If no authorized printer found (or it failed), show the browser popup
                    if (!device) {
                        device = await navigator.usb.requestDevice({ filters: [] });
                        await get()._claimInterfaceForDevice(device);
                    }

                    // User intentionally connected, so enable it globally
                    set({ usbDevice: device, isPrinterEnabled: true });
                    get().setupUsbListeners();

                    Swal.fire({ icon: 'success', title: 'USB Printer Connected', timer: 1500, showConfirmButton: false });
                } catch (error) {
                    if (error.message.includes('No device selected')) return;

                    let errorTitle = 'Connection Failed';
                    let errorMessage = "Could not connect. Please check if the printer is plugged in and turned on.";

                    if (error.message.includes('claimInterface') || error.message.includes('Access denied') || error.message.includes('protected class')) {
                        errorTitle = 'Wrong Device Selected';
                        errorMessage = "You selected a restricted system device (like a mouse or keyboard). Please click 'Connect' again and make sure to select your actual Receipt Printer.";
                    }

                    Swal.fire({
                        icon: 'error',
                        title: errorTitle,
                        text: errorMessage,
                        confirmButtonColor: '#3B82F6'
                    });
                }
            },

            connectBluetooth: async () => {
                if (Capacitor.isNativePlatform()) {
                    try {
                        await BleClient.initialize();
                        const device = await BleClient.requestDevice({
                            services: ['000018f0-0000-1000-8000-00805f9b34fb']
                        });

                        await BleClient.connect(device.deviceId, () => {
                            Swal.fire({ icon: 'warning', title: 'Printer Offline', text: 'Bluetooth Disconnected', toast: true, position: 'bottom-end', showConfirmButton: false, timer: 3000 });
                            set({ bluetoothDevice: null });
                        });

                        set({ bluetoothDevice: device, isPrinterEnabled: true });
                        Swal.fire({ icon: 'success', title: 'Bluetooth Printer Connected', timer: 1500, showConfirmButton: false });
                    } catch (error) {
                        console.error("Capacitor Bluetooth connection failed:", error);
                        if (error.message && error.message.includes('cancelled')) return;
                        Swal.fire({
                            icon: 'error',
                            title: 'Bluetooth Failed',
                            text: 'Make sure your printer is turned ON and Bluetooth is enabled.',
                            confirmButtonColor: '#3B82F6'
                        });
                    }
                } else {
                    try {
                        const device = await navigator.bluetooth.requestDevice({
                            filters: [{ services: ['000018f0-0000-1000-8000-00805f9b34fb'] }],
                            optionalServices: ['000018f0-0000-1000-8000-00805f9b34fb']
                        });

                        device.addEventListener('gattserverdisconnected', get()._handleBtDisconnect);
                        await device.gatt.connect();

                        set({ bluetoothDevice: device, isPrinterEnabled: true });
                        Swal.fire({ icon: 'success', title: 'Bluetooth Printer Connected', timer: 1500, showConfirmButton: false });
                    } catch (error) {
                        if (error.message.includes('User cancelled')) return;

                        Swal.fire({
                            icon: 'error',
                            title: 'Bluetooth Failed',
                            text: 'Make sure your printer is turned ON and in pairing mode.',
                            confirmButtonColor: '#3B82F6'
                        });
                    }
                }
            },

            // Manual disconnect button from settings
            disconnect: async () => {
                const { bluetoothDevice } = get();
                if (bluetoothDevice) {
                    if (Capacitor.isNativePlatform()) {
                        try {
                            await BleClient.disconnect(bluetoothDevice.deviceId || bluetoothDevice.id);
                        } catch (err) {
                            console.warn("BleClient disconnect failed:", err);
                        }
                    } else if (bluetoothDevice.gatt && bluetoothDevice.gatt.connected) {
                        bluetoothDevice.gatt.disconnect();
                    }
                }
                // When manually disconnected, we intentionally turn OFF auto-connect
                set({ usbDevice: null, bluetoothDevice: null, isPrinterEnabled: false });
                Swal.fire({ icon: 'info', title: 'Printer Disconnected', timer: 1500, showConfirmButton: false });
            },

            // Hardware action to pop the cash drawer via the RJ11 port
            openCashDrawer: async () => {
                const { executePrint } = get();
                // ESC p m t1 t2 (Standard ESC/POS command to kick drawer pin 2)
                const commands = new Uint8Array([0x1B, 0x70, 0x00, 0x19, 0xFA]);
                await executePrint(commands);
            },

            executePrint: async (commands) => {
                const { isMobile, usbDevice, bluetoothDevice, connectBluetooth, connectUsb } = get();
                let { isPrinterEnabled } = get();

                // 1. DYNAMIC IN-LINE PAIRING PROMPT
                if (!isPrinterEnabled) {
                    const result = await Swal.fire({
                        icon: 'warning',
                        title: 'Printer Not Connected',
                        text: 'You need to pair a printer to generate this receipt.',
                        showCancelButton: true,
                        confirmButtonText: isMobile ? 'Pair Bluetooth Printer' : 'Pair USB Printer',
                        cancelButtonText: 'Cancel',
                        confirmButtonColor: '#3B82F6',
                    });

                    if (result.isConfirmed) {
                        if (isMobile) {
                            await connectBluetooth();
                        } else {
                            await connectUsb();
                        }

                        isPrinterEnabled = get().isPrinterEnabled;
                        if (!isPrinterEnabled) return false;
                    } else {
                        return false;
                    }
                }

                try {
                    if (Capacitor.isNativePlatform()) {
                        let device = get().bluetoothDevice;

                        if (!device) {
                            await connectBluetooth();
                            device = get().bluetoothDevice;
                        } else {
                            try {
                                await BleClient.connect(device.deviceId || device.id);
                            } catch (err) {
                                // Already connected or temporary connection issue
                            }
                        }

                        if (!device) throw new Error("Bluetooth connection failed.");

                        const serviceUuid = '000018f0-0000-1000-8000-00805f9b34fb';
                        const characteristicUuid = '00002af1-0000-1000-8000-00805f9b34fb';
                        const chunkSize = 20;

                        for (let i = 0; i < commands.length; i += chunkSize) {
                            const chunk = commands.slice(i, i + chunkSize);
                            await BleClient.write(device.deviceId || device.id, serviceUuid, characteristicUuid, chunk);
                        }
                        return true;
                    } else if (isMobile) {
                        let device = get().bluetoothDevice;

                        if (!device) {
                            await connectBluetooth();
                            device = get().bluetoothDevice;
                        }
                        else if (!device.gatt.connected) {
                            console.log("Printer is asleep. Attempting silent wake-up...");
                            try {
                                await device.gatt.connect();
                            } catch (wakeError) {
                                console.warn("Silent wake-up failed. Printer might be off.", wakeError);
                                await connectBluetooth();
                                device = get().bluetoothDevice;
                            }
                        }

                        if (!device || !device.gatt.connected) throw new Error("Bluetooth connection failed.");

                        const service = await device.gatt.getPrimaryService('000018f0-0000-1000-8000-00805f9b34fb');
                        const characteristic = await service.getCharacteristic('00002af1-0000-1000-8000-00805f9b34fb');
                        const chunkSize = 20;
                        for (let i = 0; i < commands.length; i += chunkSize) {
                            await characteristic.writeValue(commands.slice(i, i + chunkSize));
                        }
                        return true;
                    } else {
                        let deviceToUse = get().usbDevice;

                        if (!deviceToUse) {
                            await get().autoConnectUsb();
                            deviceToUse = get().usbDevice;
                            if (!deviceToUse) throw new Error("Printer not reachable.");
                        }

                        // Re-claim and dynamically find the correct bulk-out printing endpoint
                        const printIfaceNumber = await get()._claimInterfaceForDevice(deviceToUse);
                        const printInterface = deviceToUse.configuration.interfaces.find(i => i.interfaceNumber === printIfaceNumber);
                        const alt = printInterface.alternate;
                        const endpoint = alt.endpoints.find(e => e.direction === 'out');

                        if (!endpoint) throw new Error("No USB print endpoint found on the active interface.");

                        // Send data in chunks of 64 bytes to prevent buffer overflow/transfer errors
                        const chunkSize = 64;
                        for (let i = 0; i < commands.length; i += chunkSize) {
                            const chunk = commands.slice(i, i + chunkSize);
                            await deviceToUse.transferOut(endpoint.endpointNumber, chunk);
                        }

                        // Force the printer to flush its internal buffer and execute the cut command
                        // immediately. We send a single Line Feed (0x0A) in a separate transfer, which
                        // forces the USB controller to flush the transfer queue and executes the cut.
                        const flush = new Uint8Array([0x0A]);
                        await deviceToUse.transferOut(endpoint.endpointNumber, flush);

                        return true;
                    }
                } catch (err) {
                    console.error("Print execution failed:", err);

                    Swal.fire({
                        icon: 'error',
                        title: 'Printer Offline',
                        text: 'Connection lost. Ensure the printer is plugged in and turned on.',
                        confirmButtonText: 'Reconnect Now',
                        showCancelButton: true,
                        cancelButtonText: 'Close',
                        confirmButtonColor: '#3B82F6',
                    }).then(async (result) => {
                        if (result.isConfirmed) {
                            if (isMobile) {
                                await get().connectBluetooth();
                            } else {
                                await get().connectUsb();
                            }
                        }
                    });

                    return false;
                }
            },

            printReceipt: async (trx, settings) => {
                const { paperWidth, executePrint } = get();
                const is80 = paperWidth === '80mm';
                const lineCap = is80 ? 48 : 30;
                const separator = "-".repeat(lineCap) + "\n";
                const fmt = (cents) => (cents / 100).toLocaleString('en-PH', { minimumFractionDigits: 2 });

                const wrapText = (text, limit) => {
                    const words = text.split(' ');
                    const lines = [];
                    let currentLine = '';

                    words.forEach(word => {
                        if (word.length > limit) {
                            if (currentLine) lines.push(currentLine.trim());
                            lines.push(word.substring(0, limit));
                            currentLine = word.substring(limit) + ' ';
                            return;
                        }
                        if ((currentLine + word).length > limit) {
                            lines.push(currentLine.trim());
                            currentLine = word + ' ';
                        } else {
                            currentLine += word + ' ';
                        }
                    });
                    if (currentLine) lines.push(currentLine.trim());
                    return lines;
                };

                const storeName = settings?.store_name || "Aivin Variety Store";
                const storeAddress = settings?.store_address || settings?.address || "";
                const storePhone = settings?.store_phone || settings?.phone || "";

                let finalCommands = [0x00, 0x00, 0x1B, 0x40, 0x1B, 0x33, 22];

                if (trx.payment_method === 'cash') {
                    finalCommands.push(0x1B, 0x70, 0x00, 0x19, 0xFA);
                }

                const header = [
                    0x1B, 0x61, 0x01, // Center align
                    0x1B, 0x45, 0x01, // Bold ON
                    ...encode(storeName.toUpperCase() + "\n"),
                    0x1B, 0x45, 0x00, // Bold OFF
                    0x1B, 0x21, 0x00, // Force standard mode (Bold OFF)
                    ...(storeAddress ? encode(storeAddress + "\n") : []),
                    ...(storePhone ? encode("Tel: " + storePhone + "\n") : []),
                    0x1B, 0x61, 0x00, // Align Left (Moved before separator)
                    ...encode(separator),
                    ...encode(`Receipt: ${trx.invoice_number || trx.transaction_code}\n`),
                    ...encode(`Date: ${new Date(trx.created_at).toLocaleString()}\n`),
                    ...encode(separator),
                ];
                finalCommands = [...finalCommands, ...header];

                // Item columns header: Row 1 description header, Row 2 subtotal header
                const itemHeader = is80
                    ? "QTY  " + "DESCRIPTION".padEnd(22) + "PRICE".padStart(10) + "AMOUNT".padStart(11) + "\n"
                    : "DESCRIPTION".padEnd(21) + " " + "PRICE".padStart(8) + "\n";

                finalCommands.push(...encode(itemHeader));
                finalCommands.push(...encode(separator));

                // Calculate original subtotal from items
                let originalSubtotal = 0;
                trx.items.forEach(item => {
                    const quantity = item.quantity;
                    const priceVal = item.unit_price || item.price || 0;
                    const amountVal = priceVal * quantity;
                    originalSubtotal += amountVal;

                    const desc = item.display_name || item.product?.name || item.custom_name || item.name || 'Item';
                    const formattedPrice = fmt(priceVal);
                    const formattedAmount = fmt(amountVal);

                    if (is80) {
                        const nameLines = wrapText(desc, 22);
                        // Line 0: Qty (5) + Desc Line 0 (22) + Price (10) + Amount (11)
                        let itemLines = quantity.toString().padEnd(5) +
                                        nameLines[0].padEnd(22) +
                                        formattedPrice.padStart(10) +
                                        formattedAmount.padStart(11) + "\n";

                        // Remaining Desc Lines: indented by 5 spaces (under DESCRIPTION column)
                        for (let i = 1; i < nameLines.length; i++) {
                            itemLines += " ".repeat(5) + nameLines[i] + "\n";
                        }
                        finalCommands.push(...encode(itemLines));
                    } else {
                        const descLimit = 21;
                        const priceLimit = 8;
                        const nameLines = wrapText(desc, descLimit);

                        // Row 1: First line of Name (left) and Unit Price (right)
                        let itemLines = nameLines[0].padEnd(descLimit) + " " + formattedPrice.padStart(priceLimit) + "\n";

                        // Row 1 Cont: Print remaining name lines (without indentation)
                        for (let i = 1; i < nameLines.length; i++) {
                            itemLines += `${nameLines[i]}\n`;
                        }

                        // Row 2: Quantity (left) and Subtotal Amount (right)
                        const qtyDetail = `${quantity}x`;
                        itemLines += `  ${qtyDetail}`.padEnd(descLimit) + " " + formattedAmount.padStart(priceLimit) + "\n";

                        finalCommands.push(...encode(itemLines));
                    }
                });

                if ((trx.discount_amount && trx.discount_amount > 0) || trx.is_senior) {
                    let discountLabel = "Less: Discount:";
                    if (trx.discount_type === 'senior') {
                        discountLabel = "Less: Senior (20%):";
                    } else if (trx.discount_type === 'pwd') {
                        discountLabel = "Less: PWD (20%):";
                    } else if (trx.discount_type === 'loyalty_5') {
                        discountLabel = "Less: Loyalty (5%):";
                    } else if (trx.discount_type === 'loyalty_10') {
                        discountLabel = "Less: VIP/Promo (10%):";
                    } else if (trx.discount_type === 'damaged_15') {
                        discountLabel = "Less: Clearance (15%):";
                    } else if (trx.discount_rate) {
                        discountLabel = `Less: Discount (${trx.discount_rate}%):`;
                    } else if (trx.is_senior) {
                        discountLabel = "Less: Senior (20%):";
                    }

                    finalCommands.push(
                        ...encode(separator),
                        ...encode("Subtotal:".padEnd(lineCap - 12) + fmt(originalSubtotal).padStart(12) + "\n"),
                        ...encode(discountLabel.padEnd(lineCap - 12) + ("-" + fmt(trx.discount_amount || 0)).padStart(12) + "\n")
                    );

                    if (trx.customer_name || trx.customer_id_number) {
                        if (trx.customer_name) {
                            finalCommands.push(...encode(`Cust: ${trx.customer_name}\n`));
                        }
                        if (trx.customer_id_number) {
                            finalCommands.push(...encode(`ID #: ${trx.customer_id_number}\n`));
                        }
                    }
                }

                finalCommands.push(...encode(separator));
                finalCommands.push(0x1B, 0x45, 0x01, ...encode("TOTAL".padEnd(10) + fmt(trx.total_amount).padStart(lineCap - 10) + "\n"), 0x1B, 0x45, 0x00, 0x1B, 0x21, 0x00);

                if (trx.payment_method === 'cash') {
                    const finalCashGiven = (trx.cash_given > 0 ? trx.cash_given : trx.total_amount);
                    const finalChange = (trx.cash_given > 0 ? trx.change : 0);
                    finalCommands.push(
                        ...encode("Cash Given:".padEnd(lineCap - 12) + fmt(finalCashGiven).padStart(12) + "\n"),
                        ...encode("Change:".padEnd(lineCap - 12) + fmt(finalChange).padStart(12) + "\n")
                    );
                } else {
                    let formattedMethod = trx.payment_method.toUpperCase();
                    if (trx.payment_method === 'credit_card') formattedMethod = 'CREDIT CARD';
                    if (trx.payment_method === 'debit_card') formattedMethod = 'DEBIT CARD';

                    finalCommands.push(
                        ...encode("Payment:".padEnd(15) + (formattedMethod).padStart(lineCap - 15) + "\n")
                    );
                }

                finalCommands.push(
                    0x1B, 0x61, 0x01, // Center align for footer
                    ...encode(separator),
                    ...encode("Thank you for shopping with us!\n"),
                    ...encode("THIS IS NOT A VALID INVOICE\n"),
                    ...encode("PLEASE ASK FOR VALID INVOICE\n"),
                    0x0A, 0x0A, 0x0A, 0x1D, 0x56, 0x41 // Cut paper
                );

                await executePrint(new Uint8Array(finalCommands));
            },

            printCashMovementSlip: async (movement, settings, user) => {
                const { paperWidth, executePrint } = get();
                const is80 = paperWidth === '80mm';
                const lineCap = is80 ? 48 : 30;
                const separator = "-".repeat(lineCap) + "\n";
                const fmt = (val) => formatCurrency(val);

                const storeName = settings?.store_name || "POS";
                const isOut = movement.type.includes('out') || movement.type === 'owner_draw' || movement.type === 'safe_drop' || movement.type === 'expense';
                const typeLabel = movement.type === 'owner_draw'
                    ? 'OWNER WITHDRAWAL / DRAW'
                    : movement.type === 'safe_drop'
                        ? 'SAFE DROP TRANSFER'
                        : movement.type === 'float_topup'
                            ? 'FLOAT TOP-UP'
                            : isOut
                                ? 'CASH OUT / EXPENSE'
                                : 'CASH IN / DEPOSIT';

                let finalCommands = [0x00, 0x00, 0x1B, 0x40, 0x1B, 0x33, 22];

                const voucher = [
                    0x1B, 0x61, 0x01, // Center align
                    0x1B, 0x45, 0x01, // Bold ON
                    ...encode(storeName.toUpperCase() + "\n"),
                    0x1B, 0x45, 0x00, // Bold OFF
                    0x1B, 0x21, 0x00,
                    ...encode("CASH MOVEMENT VOUCHER\n"),
                    ...encode(separator),
                    0x1B, 0x61, 0x00, // Align Left
                    ...encode(`Type:    ${typeLabel}\n`),
                    ...encode(`Ref:     #CM-${movement.id || Date.now().toString().slice(-6)}\n`),
                    ...encode(`Staff:   ${user?.name || movement.user?.name || "Authorized Staff"}\n`),
                    ...encode(`Date:    ${new Date(movement.created_at || Date.now()).toLocaleString()}\n`),
                    ...encode(separator),
                    0x1B, 0x45, 0x01,
                    ...encode("AMOUNT:".padEnd(lineCap - 14) + (isOut ? "-" : "+") + "P " + fmt(movement.amount).padStart(12) + "\n"),
                    0x1B, 0x45, 0x00,
                    ...encode(separator),
                    ...encode(`Reason:\n${movement.reason || "Drawer adjustment"}\n`),
                    ...encode(separator),
                    0x1B, 0x61, 0x01, // Center align
                    ...encode("\n\n____________________\n"),
                    ...encode("Authorized Signature\n"),
                    0x0A, 0x0A, 0x1D, 0x56, 0x41 // Cut paper
                ];

                await executePrint(new Uint8Array([...finalCommands, ...voucher]));
            },

            printZRead: async (data, settings) => {
                const { paperWidth, executePrint } = get();
                 const is80 = paperWidth === '80mm';
                 const lineCap = is80 ? 48 : 30;
                 const separator = "-".repeat(lineCap) + "\n";
                const fmt = (val) => formatCurrency(val);

                const diff = Number(data.difference);
                const gcash = Number(data.gcash_sales || 0);
                const maya = Number(data.maya_sales || 0);
                const credit = Number(data.credit_card_sales || 0);
                const debit = Number(data.debit_card_sales || 0);
                const totalSales = Number(data.cash_sales) + gcash + maya + credit + debit;

                let diffLabel = 'BALANCED';
                if (diff > 0.01) diffLabel = 'OVERAGE (+)';
                if (diff < -0.01) diffLabel = 'SHORTAGE (-)';

                const storeName = settings?.store_name || "POS";
                const storeAddress = settings?.store_address || settings?.address || "";
                const storePhone = settings?.store_phone || settings?.phone || "";

                let finalCommands = [0x00, 0x00, 0x1B, 0x40, 0x1B, 0x33, 22];

                finalCommands.push(0x1B, 0x70, 0x00, 0x19, 0xFA);

                const report = [
                    0x1B, 0x61, 0x01, // Center align
                    0x1B, 0x45, 0x01, // Bold ON
                    ...encode(storeName.toUpperCase() + "\n"),
                    0x1B, 0x45, 0x00, // Bold OFF
                    0x1B, 0x21, 0x00, // Force standard mode (Bold OFF)
                    ...(storeAddress ? encode(storeAddress + "\n") : []),
                    ...(storePhone ? encode("Tel: " + storePhone + "\n") : []),
                    ...encode("Z-READ REPORT\n"),
                    ...encode(separator),
                    0x1B, 0x61, 0x00, // Align Left
                    ...encode(`Cashier: ${data.user?.name || data.staff_name || "Staff"}\n`),
                    ...encode(`Opened:  ${new Date(data.start_time || data.start).toLocaleString()}\n`),
                    ...encode(`Closed:  ${new Date(data.end_time || data.end).toLocaleString()}\n`),
                    ...encode(separator),

                    // Cash Math Section (Drawer Accountability)
                    ...encode("Starting Cash:".padEnd(lineCap - 14) + fmt(data.starting_cash).padStart(14) + "\n"),
                    ...(Math.abs(Number(data.opening_discrepancy || 0)) > 0.01 ? encode(" Handover Var:".padEnd(lineCap - 14) + ((Number(data.opening_discrepancy) > 0 ? "+" : "") + fmt(data.opening_discrepancy)).padStart(14) + "\n") : []),
                    ...encode("+ Cash Sales:".padEnd(lineCap - 14) + fmt(data.cash_sales).padStart(14) + "\n"),
                    ...(Number(data.cash_in || 0) > 0 ? encode("+ Cash In / Top-up:".padEnd(lineCap - 14) + fmt(data.cash_in).padStart(14) + "\n") : []),
                    ...(Number(data.cash_out || 0) > 0 ? encode("- Cash Out / Draw:".padEnd(lineCap - 14) + ("-" + fmt(data.cash_out)).padStart(14) + "\n") : []),
                    ...(Number(data.expenses || 0) > 0 ? encode("- Expenses:".padEnd(lineCap - 14) + ("-" + fmt(data.expenses)).padStart(14) + "\n") : []),
                    ...encode(separator),

                    0x1B, 0x45, 0x01, // Bold ON for totals
                    ...encode("EXPECTED CASH:".padEnd(lineCap - 14) + fmt(data.expected_cash).padStart(14) + "\n"),
                    ...encode("ACTUAL COUNT:".padEnd(lineCap - 14) + fmt(data.actual_cash || data.ending_cash || 0).padStart(14) + "\n"),
                    ...encode(separator),

                    ...encode("DIFFERENCE:".padEnd(lineCap - 14) + ((diff > 0 ? "+" : "") + fmt(data.difference)).padStart(14) + "\n"),
                    0x1B, 0x61, 0x01, ...encode("\n[ " + diffLabel + " ]\n"), 0x1B, 0x45, 0x00, 0x1B, 0x61, 0x00, // Bold OFF, Center align, then Left align

                    ...encode(separator),

                    // NON-CASH & GROSS SALES SECTION
                    0x1B, 0x45, 0x01, ...encode("GROSS SALES BREAKDOWN\n"), 0x1B, 0x45, 0x00,
                    ...encode("Cash Sales:".padEnd(lineCap - 14) + fmt(data.cash_sales).padStart(14) + "\n"),
                    ...(gcash > 0 ? encode("GCash:".padEnd(lineCap - 14) + fmt(gcash).padStart(14) + "\n") : []),
                    ...(maya > 0 ? encode("Maya:".padEnd(lineCap - 14) + fmt(maya).padStart(14) + "\n") : []),
                    ...(credit > 0 ? encode("Credit Card:".padEnd(lineCap - 14) + fmt(credit).padStart(14) + "\n") : []),
                    ...(debit > 0 ? encode("Debit Card:".padEnd(lineCap - 14) + fmt(debit).padStart(14) + "\n") : []),

                    ...encode(separator),

                    // Total Calculation
                    0x1B, 0x45, 0x01, ...encode("TOTAL GROSS SALES:".padEnd(lineCap - 14) + fmt(totalSales).padStart(14) + "\n"), 0x1B, 0x45, 0x00,

                    ...encode(separator),

                    // Footer
                    0x1B, 0x61, 0x01, // Center align
                    ...encode(`Printed: ${new Date().toLocaleString()}\n\n\n`),
                    ...encode("____________________\n"),
                    ...encode("Manager Signature\n"),
                    0x0A, 0x0A, 0x1D, 0x56, 0x41 // Cut paper
                ];

                await executePrint(new Uint8Array([...finalCommands, ...report]));
            }
        }),
        {
            name: 'printer-settings-storage',
            partialize: (state) => ({
                paperWidth: state.paperWidth,
                isPrinterEnabled: state.isPrinterEnabled
            }),
        }
    )
);

export default usePrinterStore;