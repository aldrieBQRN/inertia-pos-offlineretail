import Swal from 'sweetalert2';
import JsBarcode from 'jsbarcode';

/**
 * 1. PRINTS the barcode label using native Browser Print.
 * Locks BOTH Thermal and A4 sheets to the exact same 40x20mm physical size.
 */
export const printLabels = (product, storeName = 'POS STORE', quantity = 1, mode = 'thermal') => {
    const barcodeData = product.barcode || product.sku || product.id?.toString() || '000000';
    const safeName = (product.name || 'Unknown Product').substring(0, 25);
    const priceVal = product.price ? (product.price / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00';

    Swal.fire({
        icon: 'info',
        title: 'Preparing Print...',
        toast: true,
        position: 'top-end',
        showConfirmButton: false,
        timer: 1500
    });

    // Generate barcode image using the locally imported JsBarcode
    let barcodeDataUrl = '';
    try {
        const barcodeCanvas = document.createElement('canvas');
        JsBarcode(barcodeCanvas, barcodeData, {
            format: "CODE128",
            width: 1,
            height: 25,
            displayValue: true,
            fontSize: 9,
            margin: 0,
            textMargin: 1
        });
        barcodeDataUrl = barcodeCanvas.toDataURL('image/png');
    } catch (e) {
        console.error("Barcode generation failed", e);
    }

    const iframe = document.createElement('iframe');
    iframe.style.position = 'absolute';
    iframe.style.width = '0px';
    iframe.style.height = '0px';
    iframe.style.border = 'none';
    document.body.appendChild(iframe);

    let labelsHtml = '';
    for (let i = 0; i < quantity; i++) {
        labelsHtml += `
            <div class="label">
                <div class="store-name">${storeName}</div>
                <div class="product-name">${safeName}</div>
                <div class="price">${priceVal}</div>
                <img class="barcode" src="${barcodeDataUrl}" />
            </div>
        `;
    }

    // Thermal Printer Mode: 1 label per page
    const thermalCss = `
        @page { size: 40mm 20mm; margin: 0; }
        body { margin: 0; display: block; }
        .page-container { display: block; }
        .label {
            width: 40mm; height: 20mm;
            page-break-after: always;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            box-sizing: border-box; padding: 1mm; overflow: hidden;
        }
        .label:last-child { page-break-after: auto; }
    `;

    // A4 Printer Mode: 5 Columns of EXACTLY 40mm x 20mm each
    const a4Css = `
        @page { size: A4; margin: 5mm; }
        body { margin: 0; }
        .page-container {
            display: grid;
            grid-template-columns: repeat(5, 40mm); /* 5 cols * 40mm = 200mm (Perfect for 210mm A4 width) */
            grid-auto-rows: 20mm;
            gap: 0;
            align-content: start;
            justify-content: center;
        }
        .label {
            width: 40mm; height: 20mm;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            box-sizing: border-box; padding: 1mm; overflow: hidden;
            border: 1px dashed #e5e7eb; /* Cutting/Peeling guide */
            page-break-inside: avoid;
        }
    `;

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { padding: 0; font-family: Arial, sans-serif; background: white; color: black; }
                .store-name { font-size: 8px; font-weight: bold; text-transform: uppercase; line-height: 1.1; max-width: 38mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
                .product-name { font-size: 7.5px; line-height: 1.1; margin: 0.5mm 0; max-width: 38mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-align: center; }
                .price { font-size: 9px; font-weight: 900; margin-bottom: 0.5mm; text-align: center; }
                .barcode { width: 36mm; height: 9mm; object-fit: contain; }
                ${mode === 'a4' ? a4Css : thermalCss}
            </style>
        </head>
        <body>
            <div class="page-container">
                ${labelsHtml}
            </div>
        </body>
        </html>
    `;

    const iframeDoc = iframe.contentWindow || iframe.contentDocument;
    const doc = iframeDoc.document || iframeDoc;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    // Give images and DOM time to render before invoking print dialog
    setTimeout(() => {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();

        // Remove iframe after print dialog completes
        setTimeout(() => {
            if (document.body.contains(iframe)) {
                document.body.removeChild(iframe);
            }
        }, 3000);
    }, 500);
};

/**
 * 2. DOWNLOADS the barcode label as a PNG image.
 * Uses a strict 400x200 canvas to perfectly replicate the 40x20mm physical aspect ratio.
 */
export const downloadLabelImage = (product, storeName = 'POS STORE') => {
    const barcodeData = product.barcode || product.sku || product.id?.toString() || '000000';
    const safeName = (product.name || 'Unknown Product').substring(0, 30);
    const priceVal = product.price ? (product.price / 100).toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00';

    // 400x200 is exactly a 2:1 ratio (Same as 40mm x 20mm)
    const canvas = document.createElement('canvas');
    canvas.width = 400;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';

    ctx.font = 'bold 18px Arial';
    ctx.fillText(storeName, 200, 25);

    ctx.font = '16px Arial';
    ctx.fillText(safeName, 200, 50);

    ctx.font = 'bold 20px Arial';
    ctx.fillText(priceVal, 200, 75);

    const barcodeCanvas = document.createElement('canvas');
    try {
        JsBarcode(barcodeCanvas, barcodeData, {
            format: "CODE128",
            width: 2,
            height: 50,
            displayValue: true,
            fontSize: 14,
            margin: 0,
            textMargin: 4
        });

        const bcWidth = barcodeCanvas.width;
        const xPos = (400 - bcWidth) / 2;
        ctx.drawImage(barcodeCanvas, xPos, 90);

        const imgData = canvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.href = imgData;
        const storePrefix = (storeName || 'POS').replace(/[^a-zA-Z0-9_-]/g, '_');
        const productPrefix = safeName.replace(/[^a-zA-Z0-9_-]/g, '_');
        link.download = `${storePrefix}_${productPrefix}_barcode.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        Swal.fire({ icon: 'success', title: 'Saved!', text: 'Barcode image downloaded successfully.', toast: true, position: 'top-end', showConfirmButton: false, timer: 2000 });

    } catch (e) {
        console.error("Barcode image generation failed", e);
        Swal.fire('Error', 'Could not generate barcode image.', 'error');
    }
};