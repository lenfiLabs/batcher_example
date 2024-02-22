FROM node:18

# install deno
RUN curl -fsSL https://deno.land/x/install/install.sh | sh
RUN mv /root/.deno/bin/deno /usr/bin/deno

WORKDIR /app
COPY ["package.json", "package-lock.json*", "./"]

RUN yarn install
COPY . .

CMD ["/usr/bin/deno", "run", "-A", "src/index.ts"]
