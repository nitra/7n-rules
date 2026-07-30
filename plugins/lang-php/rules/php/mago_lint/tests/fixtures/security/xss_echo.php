<?php

declare(strict_types=1);

function renderGreeting(): void
{
    $name = $_GET['name'];
    echo '<div>Hello, ' . $name . '!</div>';
}
