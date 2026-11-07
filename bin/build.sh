#!/bin/bash
set -e

echo "Installing dependencies..."
composer install --no-interaction --no-dev --prefer-dist --optimize-autoloader

echo "Caching config..."
php artisan config:cache

echo "Caching routes..."
php artisan route:cache

echo "Creating storage directories..."
mkdir -p storage/framework/views
mkdir -p storage/logs
mkdir -p storage/framework/cache
mkdir -p storage/framework/sessions

echo "Running migrations..."
php artisan migrate --force

echo "Build complete!"
