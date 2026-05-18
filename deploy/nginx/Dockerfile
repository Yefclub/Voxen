FROM nginx:1.27-alpine

# Remove default site
RUN rm -f /etc/nginx/conf.d/default.conf

COPY deploy/nginx/voxen.container.conf /etc/nginx/conf.d/voxen.conf

EXPOSE 80 443
