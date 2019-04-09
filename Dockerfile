FROM node:11.4.0

# install ImageMagick
RUN apt-get -y update && \
    apt-get -y upgrade && \
    apt-get -y install make gcc pkg-config autoconf && \
    apt-get -y install libpng16-16 libpng-dev libjpeg62-turbo libjpeg62-turbo-dev libwebp6 libwebp-dev libgomp1 libwebpmux2 libwebpdemux2 && \
    git clone https://github.com/ImageMagick/ImageMagick.git && \
    cd ImageMagick && git checkout 7.0.8-36 && \
    ./configure && make && make install && \
    ldconfig /usr/local/lib && \
    apt-get remove --autoremove --purge -y gcc make autoconf pkg-config libpng-dev libjpeg62-turbo-dev libwebp-dev && \
    rm -rf /var/lib/apt/lists/* && \
    rm -rf /ImageMagick

RUN git clone https://github.com/Hiro-Nakamura/ab_service_image_processor.git app && \
	cd app && \
	yarn install

WORKDIR /app
CMD ["node", "--inspect", "app.js"]
