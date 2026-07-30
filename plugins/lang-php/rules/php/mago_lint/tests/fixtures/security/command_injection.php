<?php

declare(strict_types=1);

function pingHost(): string|false
{
    $host = $_GET['host'];
    return shell_exec('ping -c 1 ' . $host);
}
