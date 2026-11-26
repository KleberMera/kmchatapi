#!/bin/bash

echo "======================================"
echo " Iniciando despliegue de la API"
echo "======================================"

echo ""
echo "Actualizando repositorio..."
git fetch --all

git pull

echo ""
echo "Preparando almacenamiento de videos..."
export BULK_MEDIA_DIR="${BULK_MEDIA_DIR:-$HOME/masivawsp/bulk-media}"
mkdir -p "$BULK_MEDIA_DIR"
export PUPPETEER_EXECUTABLE_PATH="${PUPPETEER_EXECUTABLE_PATH:-/usr/bin/google-chrome-stable}"
if [ ! -x "$PUPPETEER_EXECUTABLE_PATH" ]; then
    echo "❌ No se encontró Chrome ejecutable en $PUPPETEER_EXECUTABLE_PATH."
    echo "Instala Google Chrome o configura PUPPETEER_EXECUTABLE_PATH antes del despliegue."
    exit 1
fi

echo ""
echo "Instalando dependencias..."
npm install

echo ""
echo "Compilando proyecto..."
npm run build

if [ $? -ne 0 ]; then
    echo ""
    echo "❌ Error durante la compilación."
    exit 1
fi

echo ""
echo "Reiniciando PM2..."
pm2 restart kmchat-api --update-env

echo ""
echo "Guardando configuración de PM2..."
pm2 save

echo ""
echo "======================================"
echo "✅ Despliegue finalizado correctamente"
echo "======================================"